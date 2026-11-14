import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { configuration } from "../apps/gateway/src/config.js";
import { bootstrap } from "../apps/gateway/src/service.js";
import { runDemoScenario } from "../apps/gateway/src/scenario.js";
if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "Set TEST_DATABASE_URL to a disposable local PostgreSQL instance.",
  );
const url = new URL(process.env.TEST_DATABASE_URL);
const admin = new pg.Pool({ connectionString: url.href });
const schema = `aimo_test_${randomUUID().replaceAll("-", "")}`;
const directory = await mkdtemp(join(tmpdir(), "aimo-pg-"));
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const service = await bootstrap({
    ...configuration(),
    mock: true,
    demo: true,
    stateDir: directory,
    databaseUrl: url.href,
  });
  try {
    const result = await runDemoScenario(service);
    assert.equal(result.auto.status, "placed");
    assert.equal(result.blocked.status, "refused");
    const pending = (await service.snapshot()).approvals.find(
      (a) => a.id === result.held.approvalId,
    )!;
    const decision = {
      decision: "approve" as const,
      revision: 1,
      challengeToken: pending.challengeToken,
    };
    const outcomes = await Promise.allSettled([
      service.decide(pending.id, decision, "maija"),
      service.decide(pending.id, decision, "maija"),
    ]);
    assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
    assert.equal(
      (await service.snapshot()).orders.filter(
        (o) => o.proposalId === result.held.id,
      ).length,
      1,
    );
    assert.equal((await service.verifyLedger()).valid, true);
    console.log(
      "PostgreSQL verified: AUTO / HOLD / REFUSE, concurrent first-decision-wins, one order, intact ledger.",
    );
  } finally {
    await service.db.close();
  }
} finally {
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
