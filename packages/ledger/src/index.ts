import { canonical, sha256 } from "@aimo/signing";
import type { LedgerEvent } from "@aimo/schema";
import type { Repository } from "@aimo/database";
type EventInput = Omit<LedgerEvent, "seq" | "ts" | "prevHash" | "hash">;
export async function append(
  repo: Repository,
  input: EventInput,
  now = new Date(),
): Promise<LedgerEvent> {
  const rows = await repo.sql.query(
    "SELECT data FROM ledger_events ORDER BY seq DESC LIMIT 1",
  );
  const previous = rows.rows[0]?.data as LedgerEvent | undefined;
  const event = {
    ...input,
    seq: (previous?.seq ?? 0) + 1,
    ts: now.toISOString(),
    prevHash: previous?.hash ?? "0".repeat(64),
  };
  const record = { ...event, hash: sha256(event.prevHash + canonical(event)) };
  await repo.sql.query(
    "INSERT INTO ledger_events (seq,data) VALUES ($1,$2::jsonb)",
    [record.seq, JSON.stringify(record)],
  );
  return record;
}
export async function events(
  repo: Repository,
  customerId?: string,
): Promise<LedgerEvent[]> {
  const rows = await repo.sql.query(
    `SELECT data FROM ledger_events${customerId ? " WHERE data->>'customerId'=$1" : ""} ORDER BY seq`,
    customerId ? [customerId] : [],
  );
  return rows.rows.map((r) => r.data as LedgerEvent);
}
export function verifyChain(records: LedgerEvent[]) {
  let prevHash = "0".repeat(64);
  let seq = 1;
  for (const { hash, ...event } of records) {
    if (
      event.seq !== seq ||
      event.prevHash !== prevHash ||
      sha256(prevHash + canonical(event)) !== hash
    )
      return { valid: false, brokenAt: event.seq, count: records.length };
    prevHash = hash;
    seq++;
  }
  return { valid: true, count: records.length, headHash: prevHash };
}
