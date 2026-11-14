import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { configuration } from "../apps/gateway/src/config.js";
import { bootstrap } from "../apps/gateway/src/service.js";
import { runDemoScenario } from "../apps/gateway/src/scenario.js";
const directory = await mkdtemp(join(tmpdir(), "aimo-demo-"));
const service = await bootstrap({
  ...configuration(),
  mock: true,
  demo: true,
  databaseUrl: undefined,
  stateDir: directory,
});
try {
  const result = await runDemoScenario(service);
  assert.equal(result.auto.status, "placed");
  assert.equal(result.held.status, "held");
  assert.equal(result.blocked.status, "refused");
  console.log("Catalog:", service.catalog.products.length, "supplied products");
  console.log("Offers:", result.offers.length, "signed mock offers");
  console.log(
    "Substitutes:",
    result.substitutions
      .map(
        (s) =>
          `${s.productId} → ${s.candidates.map((c) => c.product.id).join(", ")}`,
      )
      .join("; "),
  );
  console.log("AUTO:", result.auto.orderId);
  console.log(
    "HOLD:",
    result.held.verdict.firedRules.map((r) => r.id).join(", "),
  );
  console.log(
    "REFUSE:",
    result.blocked.verdict.firedRules.map((r) => r.code).join(", "),
  );
  const snapshot = await service.snapshot();
  const approval = snapshot.approvals.find(
    (a) => a.id === result.held.approvalId,
  )!;
  const decided = await service.decide(
    approval.id,
    {
      decision: "approve",
      challengeToken: approval.challengeToken,
      revision: result.held.revision,
    },
    "maija",
  );
  assert.equal(decided.proposal.status, "placed");
  console.log("APPROVED:", decided.proposal.orderId);
  const verified = await service.verifyLedger();
  assert.equal(verified.valid, true);
  console.log("Ledger verify OK:", verified.count, "events");
  await mkdir(".local", { recursive: true });
  await writeFile(
    ".local/demo-result.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        auto: result.auto.orderId,
        approved: decided.proposal.orderId,
        refused: result.blocked.id,
        ledger: verified,
      },
      null,
      2,
    ),
  );
} finally {
  await service.db.close();
  await rm(directory, { recursive: true, force: true });
}
