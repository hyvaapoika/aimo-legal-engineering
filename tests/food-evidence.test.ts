import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  proposalSchema,
  type Proposal,
  type SupplierDeclaration,
} from "@aimo/schema";
import { createApp } from "../apps/gateway/src/http.js";
import { importDeclaration } from "../apps/gateway/src/supplier-declarations.js";
import { checkEggDeclaration } from "../packages/rules/src/egg-evidence.js";
import {
  fixtureProduct,
  fixtureTime,
  foodEvidenceFixture,
  loadFixtureDeclaration,
} from "../scripts/food-evidence-fixture.js";
import { testConfig } from "./helpers.js";

const declared = await loadFixtureDeclaration("declared");
const withdrawn = await loadFixtureDeclaration("withdrawn");

describe("kitchen rule KITCHEN-EGG-01/v1", () => {
  it.each([
    ["declared_free", "supported"],
    ["not_stated", "unknown"],
    ["contains", "contradicted"],
    ["may_contain", "contradicted"],
  ] as const)("a supplier statement of %s yields %s", (egg, expected) => {
    expect(
      checkEggDeclaration(fixtureProduct, { ...declared, egg }).outcome,
    ).toBe(expected);
  });
  it("needs the exact product and an actual declaration even if a catalogue flag says free", () => {
    const product = { ...fixtureProduct, allergenFree: ["AE"] };
    expect(checkEggDeclaration(product, undefined).outcome).toBe("unknown");
    expect(
      checkEggDeclaration(product, { ...declared, productId: "OTHER" }).outcome,
    ).toBe("unknown");
  });
  it("checks egg warnings in both the quoted product and the latest catalogue record", () => {
    const warned = { ...fixtureProduct, allergens: ["AE"] };
    expect(checkEggDeclaration(warned, declared, fixtureProduct).outcome).toBe(
      "contradicted",
    );
    expect(checkEggDeclaration(fixtureProduct, declared, warned).outcome).toBe(
      "contradicted",
    );
  });
});

describe("purchasing approval with versioned supplier evidence", () => {
  let ctx: Awaited<ReturnType<typeof foodEvidenceFixture>>;
  beforeEach(async () => {
    ctx = await foodEvidenceFixture();
  });
  afterEach(async () => {
    await ctx.service.db.close();
  });
  const record = (row: SupplierDeclaration) =>
    importDeclaration(ctx.service.db, row, fixtureTime);
  async function review(proposal: Proposal) {
    const approval = (await ctx.service.snapshot()).approvals.find(
      (a) => a.id === proposal.approvalId,
    )!;
    return {
      id: approval.id,
      body: {
        decision: "approve" as const,
        challengeToken: approval.challengeToken,
        revision: proposal.revision,
      },
    };
  }
  it("refuses a missing document, places at the spending limit and allows a genuine manager budget exception", async () => {
    const { service, agent, request } = ctx;
    const missing = await service.submit(agent, request("missing"));
    expect(missing).toMatchObject({
      status: "refused",
      verdict: {
        foodEvidence: {
          origin: "kitchen_policy",
          lines: [{ outcome: "unknown", declaration: null }],
        },
      },
    });
    expect(missing.approvalId).toBeUndefined();
    await record(declared);
    expect((await service.submit(agent, request("at-limit", 10))).status).toBe(
      "placed",
    );
    const held = await service.submit(agent, request("budget"));
    expect(held.verdict.firedRules.map((r) => r.code)).toEqual(["ORDER_LIMIT"]);
    const pending = await review(held);
    const { proposal, approval } = await service.decide(
      pending.id,
      pending.body,
      "maija",
    );
    expect(proposal.status).toBe("placed");
    expect(
      await service.signer.verify(
        {
          approvalId: pending.id,
          lineHash: approval.lineHash,
          foodEvidenceDigest: approval.foodEvidenceDigest,
          decision: "approve",
          approverId: "maija",
          decidedAt: approval.decidedAt,
        },
        approval.signature!,
      ),
    ).toBe(true);
    await record(withdrawn);
    expect((await service.submit(agent, request("budget"))).orderId).toBe(
      proposal.orderId,
    );
    expect((await service.snapshot()).orders).toHaveLength(2);
  });
  it("makes a changed declaration visible over REST and MCP and creates no order on a retry", async () => {
    const { service, agent, credentials, request } = ctx;
    await record(declared);
    const app = createApp(service, testConfig);
    const buyerHeaders = {
      Authorization: "Bearer " + credentials.token,
      "Content-Type": "application/json",
    };
    const posted = await app.request("/v1/proposals", {
      method: "POST",
      headers: buyerHeaders,
      body: JSON.stringify(request("same-basket")),
    });
    expect(posted.status).toBe(200);
    const held = proposalSchema.parse(await posted.json());
    const pending = await review(held);
    await record(withdrawn);
    const confirm = () =>
      app.request(`/admin/approvals/${pending.id}/decide`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + testConfig.adminToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pending.body),
      });
    const response = await confirm();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "FOOD_EVIDENCE_REVIEW_CHANGED",
    });
    expect((await confirm()).status).toBe(409);
    const rest = await app.request(`/v1/proposals/${held.id}`, {
      headers: buyerHeaders,
    });
    expect(rest.status).toBe(200);
    const current = proposalSchema.parse(await rest.json());
    expect(current).toMatchObject({
      status: "refused",
      lines: held.lines,
      totalCents: held.totalCents,
      invalidatedReview: {
        previousVerdictId: held.verdict.id,
        previousEvidence: { lines: [{ declaration: declared }] },
      },
      verdict: {
        foodEvidence: {
          lines: [{ declaration: withdrawn, outcome: "unknown" }],
        },
      },
    });
    expect(current.invalidatedReview!.currentDigest).not.toBe(
      current.invalidatedReview!.previousDigest,
    );
    expect(current.orderId).toBeUndefined();
    const client = new Client({ name: "evidence-receipt-test", version: "1" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
          requestInit: {
            headers: { Authorization: buyerHeaders.Authorization },
          },
          fetch: async (url, init) => app.fetch(new Request(url, init)),
        }),
      );
      const result = await client.callTool({
        name: "get_proposal",
        arguments: { id: held.id },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(proposalSchema.parse(JSON.parse(content[0]!.text))).toEqual(
        current,
      );
    } finally {
      await client.close();
    }
    expect((await service.submit(agent, request("same-basket"))).status).toBe(
      "refused",
    );
    const snapshot = await service.snapshot();
    expect(snapshot.orders).toHaveLength(0);
    expect(
      snapshot.events.filter(
        (e) =>
          e.type === "approval.invalidated" && e.refs.proposalId === held.id,
      ),
    ).toHaveLength(1);
    expect((await service.verifyLedger()).valid).toBe(true);
  });
  it("expires an amendment when the supplier reissues even a supporting statement", async () => {
    const { service, agent, request } = ctx;
    await record(declared);
    const held = await service.submit(agent, request("amended-quantity"));
    const pending = await review(held);
    await record({ ...declared, revision: 2 });
    await expect(
      service.decide(
        pending.id,
        {
          ...pending.body,
          decision: "approve_with_amount",
          amendedLines: [{ productId: declared.productId, qty: 3 }],
        },
        "maija",
      ),
    ).rejects.toMatchObject({ code: "FOOD_EVIDENCE_REVIEW_CHANGED" });
    expect((await service.getProposal(agent, held.id)).status).toBe("expired");
    expect((await service.snapshot()).orders).toHaveLength(0);
    expect(
      (await service.submit(agent, request("fresh-review", 3))).status,
    ).toBe("placed");
  });
  it("binds an approved quantity amendment to the evidence and evaluates the replacement basket", async () => {
    const { service, agent, request } = ctx;
    await record(declared);
    const held = await service.submit(agent, request("fewer-packs"));
    const pending = await review(held);
    const amendedLines = [{ productId: declared.productId, qty: 3 }];
    const { approval } = await service.decide(
      pending.id,
      {
        ...pending.body,
        decision: "approve_with_amount",
        amendedLines,
      },
      "maija",
    );
    expect(approval.status).toBe("amended");
    expect(
      await service.signer.verify(
        {
          approvalId: pending.id,
          lineHash: approval.lineHash,
          foodEvidenceDigest: approval.foodEvidenceDigest,
          decision: "approve_with_amount",
          amendedLines,
          approverId: "maija",
          decidedAt: approval.decidedAt,
        },
        approval.signature!,
      ),
    ).toBe(true);
    const replacement = await service.getProposal(
      agent,
      approval.replacementProposalId!,
    );
    expect(replacement).toMatchObject({
      status: "placed",
      totalCents: 3000,
      verdict: { foodEvidence: { lines: [{ declaration: declared }] } },
    });
  });
  it("rechecks delegated authority while price, basket and supplier evidence are unchanged", async () => {
    const { service, agent, request } = ctx;
    await record(declared);
    const held = await service.submit(agent, request("authority-change"));
    const pending = await review(held);
    await service.updateAgent(agent.id, {
      mandate: {
        ...agent.mandate,
        limits: { ...agent.mandate.limits, perOrder: 80 },
      },
    });
    await expect(
      service.decide(pending.id, pending.body, "maija"),
    ).rejects.toMatchObject({ code: "FOOD_EVIDENCE_REVIEW_CHANGED" });
    expect(
      (await service.getProposal(agent, held.id)).verdict.foodEvidence
        ?.mandateVersion,
    ).toBe(2);
    expect((await service.snapshot()).orders).toHaveLength(0);
  });
  it("preserves unscoped purchases and requires fresh review when an existing mandate adopts the policy", async () => {
    const { service, agent, request } = ctx;
    await service.updateAgent(agent.id, {
      mandate: { ...agent.mandate, requireEggDeclaration: false },
    });
    const routine = await service.submit(agent, request("legacy", 2));
    expect(routine.status).toBe("placed");
    expect(routine.verdict.foodEvidence).toBeUndefined();
    const held = await service.submit(agent, request("pending-legacy"));
    const pending = await review(held);
    await service.updateAgent(agent.id, {
      mandate: { ...agent.mandate, requireEggDeclaration: true },
    });
    await expect(
      service.decide(pending.id, pending.body, "maija"),
    ).rejects.toMatchObject({ code: "FOOD_EVIDENCE_REVIEW_CHANGED" });
    expect((await service.getProposal(agent, held.id)).status).toBe("refused");
  });
  it("makes operator imports idempotent and rejects conflicting, retrograde and future-dated versions", async () => {
    await Promise.all([record(declared), record(declared)]);
    await expect(
      record({ ...declared, egg: "contains" }),
    ).rejects.toMatchObject({ code: "DECLARATION_REVISION_CONFLICT" });
    await record(withdrawn);
    await expect(record(declared)).rejects.toMatchObject({
      code: "DECLARATION_REVISION_CONFLICT",
    });
    await expect(
      record({ ...declared, revision: 3, issuedAt: "2030-01-01T00:00:00Z" }),
    ).rejects.toMatchObject({ code: "FUTURE_DECLARATION" });
    const { service, agent, request } = ctx;
    expect(
      (await service.submit(agent, request("latest"))).verdict.foodEvidence
        ?.lines[0]?.declaration,
    ).toEqual(withdrawn);
  });
});
