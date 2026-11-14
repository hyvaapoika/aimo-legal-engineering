import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { input, setup, delivery } from "./helpers.js";
import { runDemoScenario } from "../apps/gateway/src/scenario.js";
import { processApprovalQueue } from "../apps/gateway/src/worker.js";
import type { Agent, Approval, Offer } from "@aimo/schema";
import { exportOrder } from "@aimo/peppol";
import { XMLParser, XMLValidator } from "fast-xml-parser";
let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => {
  await ctx.service.db.close();
});
async function milk(qty = 100) {
  const { offers } = await ctx.service.getOffers(ctx.agent, {
    productIds: ["464201"],
    requestedDate: delivery,
  });
  return { offer: offers[0]!, request: input(offers[0]!, qty) };
}
async function approval(id: string) {
  return (await ctx.service.snapshot()).approvals.find((a) => a.id === id)!;
}
describe("commerce lifecycle", () => {
  it("runs the complete four-line demo and records approval provenance", async () => {
    const result = await runDemoScenario(ctx.service);
    expect(result.auto.status).toBe("placed");
    expect(result.held.status).toBe("held");
    expect(result.blocked.status).toBe("refused");
    expect(result.short.status).toBe("held");
    const pending = await approval(result.held.approvalId!);
    const decided = await ctx.service.decide(
      pending.id,
      {
        decision: "approve",
        revision: 1,
        challengeToken: pending.challengeToken,
      },
      "maija",
    );
    expect(decided.proposal.status).toBe("placed");
    const order = await ctx.service.getOrder(
      ctx.agent,
      decided.proposal.orderId!,
    );
    expect(order.approvalId).toBe(pending.id);
    expect(order.lines).toHaveLength(4);
    const xml = exportOrder(order);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(new XMLParser().parse(xml).Order["cbc:CustomizationID"]).toBe(
      "urn:fdc:peppol.eu:poacc:trns:order:3",
    );
    expect(await ctx.service.verifyLedger()).toMatchObject({ valid: true });
  });
  it("returns the same order for concurrent retries and refuses changed payloads with the same key", async () => {
    const { request } = await milk(20);
    const [a, b] = await Promise.all([
      ctx.service.submit(ctx.agent, request),
      ctx.service.submit(ctx.agent, request),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.orderId).toBe(b.orderId);
    await expect(
      ctx.service.submit(ctx.agent, {
        ...request,
        lines: request.lines.map((l) => ({ ...l, qty: 21 })),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("allows only the first human decision and creates exactly one order", async () => {
    const { request } = await milk(2500);
    const proposal = await ctx.service.submit(ctx.agent, request);
    const pending = await approval(proposal.approvalId!);
    const decision = {
      decision: "approve" as const,
      revision: 1,
      challengeToken: pending.challengeToken,
    };
    const outcomes = await Promise.allSettled([
      ctx.service.decide(pending.id, decision, "maija"),
      ctx.service.decide(pending.id, decision, "maija"),
    ]);
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      (await ctx.service.snapshot()).orders.filter(
        (o) => o.proposalId === proposal.id,
      ),
    ).toHaveLength(1);
  });
  it("does not allow human approval to invent stock; amendment re-enters the rules", async () => {
    const { offers } = await ctx.service.getOffers(ctx.agent, {
      productIds: ["461885"],
      requestedDate: delivery,
    });
    const proposal = await ctx.service.submit(
      ctx.agent,
      input(offers[0]!, 150),
    );
    const pending = await approval(proposal.approvalId!);
    const decision = { revision: 1, challengeToken: pending.challengeToken };
    await expect(
      ctx.service.decide(
        pending.id,
        { ...decision, decision: "approve" },
        "maija",
      ),
    ).rejects.toMatchObject({ code: "REVALIDATION_REQUIRED" });
    const amended = await ctx.service.decide(
      pending.id,
      {
        ...decision,
        decision: "approve_with_amount",
        amendedLines: [{ productId: "461885", qty: 100 }],
      },
      "maija",
    );
    expect(amended.proposal.status).toBe("amended");
    expect(amended.approval.replacementProposalId).toBeTruthy();
    const replacement = await ctx.service.getProposal(
      ctx.agent,
      amended.approval.replacementProposalId!,
    );
    expect(replacement.lines[0]!.qty).toBe(100);
    expect(replacement.status).toBe("held");
  });
  it("rejects unregistered approvers and stale challenges", async () => {
    const { request } = await milk(2500);
    const proposal = await ctx.service.submit(ctx.agent, request);
    const pending = await approval(proposal.approvalId!);
    await expect(
      ctx.service.decide(
        pending.id,
        {
          decision: "approve",
          revision: 1,
          challengeToken: pending.challengeToken,
        },
        "stranger",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      ctx.service.decide(
        pending.id,
        { decision: "approve", revision: 1, challengeToken: "wrong" },
        "maija",
      ),
    ).rejects.toMatchObject({ code: "STALE_DECISION" });
  });
  it("rejects price tampering even when the offer ID is unchanged", async () => {
    const { offer, request } = await milk();
    await ctx.service.db.transaction((repo) =>
      repo.put("offers", { ...offer, price: { ...offer.price!, value: 0.01 } }),
    );
    const result = await ctx.service.submit(ctx.agent, request);
    expect(result.status).toBe("refused");
    expect(
      result.verdict.firedRules.some((r) => r.id === "FEAS_OFFER_VALID"),
    ).toBe(true);
  });
  it("isolates offers and orders by customer and proposal reads by agent", async () => {
    const other: Agent = {
      ...ctx.agent,
      id: randomUUID(),
      customerId: "other-customer",
    };
    const { request } = await milk();
    const result = await ctx.service.submit(other, request);
    expect(result.status).toBe("refused");
    expect(
      result.verdict.firedRules.some((r) => r.id === "AUTH_CUSTOMER_MATCH"),
    ).toBe(true);
    const normal = await ctx.service.submit(ctx.agent, {
      ...request,
      idempotencyKey: randomUUID(),
    });
    await expect(
      ctx.service.getProposal(other, normal.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rejects buyer-supplied totals and identities at the schema boundary", async () => {
    const { request } = await milk();
    await expect(
      ctx.service.submit(ctx.agent, {
        ...request,
        totalCents: 1,
        customerId: "other",
      }),
    ).rejects.toThrow();
  });
  it("persists inbox routing and expires held proposals", async () => {
    const { request } = await milk(2500);
    const proposal = await ctx.service.submit(ctx.agent, request);
    await processApprovalQueue(ctx.service);
    const pending = await approval(proposal.approvalId!);
    expect(pending.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "app",
          outcome: "available_in_inbox",
        }),
      ]),
    );
    ctx.setTime(new Date("2026-11-14T15:00:01Z"));
    await processApprovalQueue(ctx.service);
    expect((await approval(pending.id)).status).toBe("expired");
    expect((await ctx.service.getProposal(ctx.agent, proposal.id)).status).toBe(
      "expired",
    );
  });
});
