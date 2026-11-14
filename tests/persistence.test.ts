import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase } from "@aimo/database";
import { append, events, verifyChain } from "@aimo/ledger";
it("preserves business records and the ledger across an embedded database restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aimo-persistence-"));
  try {
    const first = await createDatabase(undefined, join(directory, "db"));
    await first.transaction(async (repo) => {
      await repo.put("jobs", { id: "pending-job", state: "pending" });
      await append(repo, {
        type: "persistence.test",
        customerId: "test",
        actor: { kind: "aimo", id: "test" },
        refs: {},
        payload: { state: "pending" },
      });
    });
    await first.close();
    const reopened = await createDatabase(undefined, join(directory, "db"));
    try {
      expect(
        await reopened.transaction((repo) => repo.get("jobs", "pending-job")),
      ).toEqual({ id: "pending-job", state: "pending" });
      expect(
        await reopened.transaction(async (repo) =>
          verifyChain(await events(repo)),
        ),
      ).toMatchObject({ valid: true, count: 1 });
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
