import assert from "node:assert/strict";
import type { Proposal } from "@aimo/schema";
import { importDeclaration } from "../apps/gateway/src/supplier-declarations.js";
import {
  fixtureTime,
  foodEvidenceFixture,
  loadFixtureDeclaration,
} from "./food-evidence-fixture.js";

const { service, agent, request } = await foodEvidenceFixture();
async function approve(proposal: Proposal) {
  const review = (await service.snapshot()).approvals.find(
    (a) => a.id === proposal.approvalId,
  )!;
  return service.decide(
    review.id,
    {
      decision: "approve",
      revision: proposal.revision,
      challengeToken: review.challengeToken,
    },
    "maija",
  );
}
try {
  const missing = await service.submit(agent, request("no-document"));
  assert.equal(missing.status, "refused");
  console.log(
    "1. No supplier declaration. The kitchen rule excludes this pasta.",
  );

  await importDeclaration(
    service.db,
    await loadFixtureDeclaration("declared"),
    fixtureTime,
  );
  const within = await service.submit(agent, request("within-budget", 4));
  assert.equal(within.status, "placed");
  console.log(
    "2. Revision 1 supports the claim. Four packs cost €40, within the €100 mandate. Simulated order placed.",
  );

  const over = await service.submit(agent, request("budget-exception"));
  assert.equal(over.status, "held");
  assert.ok(over.verdict.firedRules.some((r) => r.code === "ORDER_LIMIT"));
  const approved = await approve(over);
  assert.equal(approved.proposal.status, "placed");
  console.log(
    `3. Twelve packs cost €120. The manager approved the €20 budget exception. Simulated order ${approved.proposal.orderId}.`,
  );

  const pending = await service.submit(agent, request("revised-during-review"));
  await importDeclaration(
    service.db,
    await loadFixtureDeclaration("withdrawn"),
    fixtureTime,
  );
  await assert.rejects(approve(pending), {
    code: "FOOD_EVIDENCE_REVIEW_CHANGED",
  });
  const stopped = await service.getProposal(agent, pending.id);
  assert.equal(stopped.status, "refused");
  assert.equal(stopped.orderId, undefined);
  assert.equal(
    (await service.submit(agent, request("revised-during-review"))).id,
    stopped.id,
  );
  const snapshot = await service.snapshot();
  assert.equal(
    snapshot.orders.filter((o) => o.proposalId === pending.id).length,
    0,
  );
  assert.ok((await service.verifyLedger()).valid);
  console.log(
    "4. Same pasta, price and quantity. The supplier withdrew its declaration during review. Approval stopped; zero orders for this request.",
  );
  console.log(
    JSON.stringify(
      {
        rule: pending.verdict.foodEvidence!.ruleId,
        before: stopped.invalidatedReview!.previousEvidence!.lines[0],
        after: stopped.verdict.foodEvidence!.lines[0],
        originalTotalCents: pending.totalCents,
        finalTotalCents: stopped.totalCents,
        auditEvent: snapshot.events.find(
          (e) =>
            e.type === "approval.invalidated" &&
            e.refs.proposalId === pending.id,
        )?.type,
      },
      null,
      2,
    ),
  );
} finally {
  await service.db.close();
}
