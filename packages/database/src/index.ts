import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const tables = [
  "agents",
  "offers",
  "proposals",
  "approvals",
  "orders",
  "mandates",
  "verdicts",
  "jobs",
  "kitchen_profiles",
  "purchase_plans",
] as const;
export type Table = (typeof tables)[number];
export interface Sql {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export class Repository {
  constructor(readonly sql: Sql) {}
  async get<T>(table: Table, id: string): Promise<T | undefined> {
    const result = await this.sql.query(
      `SELECT data FROM ${table} WHERE id=$1`,
      [id],
    );
    return result.rows[0]?.data as T | undefined;
  }
  async all<T>(table: Table, customerId?: string): Promise<T[]> {
    const result = await this.sql.query(
      `SELECT data FROM ${table}${customerId ? " WHERE data->>'customerId'=$1" : ""} ORDER BY id`,
      customerId ? [customerId] : [],
    );
    return result.rows.map((row) => row.data as T);
  }
  async put<T extends { id: string }>(table: Table, value: T) {
    await this.sql.query(
      `INSERT INTO ${table} (id,data) VALUES ($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      [value.id, JSON.stringify(value)],
    );
  }
}
export interface Database {
  transaction<T>(fn: (repository: Repository) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function createDatabase(
  url?: string,
  directory?: string,
): Promise<Database> {
  let pool: pg.Pool | undefined;
  let embedded: PGlite | undefined;
  if (url) pool = new pg.Pool({ connectionString: url, max: 5 });
  else {
    if (directory) await mkdir(dirname(directory), { recursive: true });
    embedded = new PGlite(directory);
    await embedded.waitReady;
  }
  let tail: Promise<unknown> = Promise.resolve();
  const transaction = <T>(
    fn: (repository: Repository) => Promise<T>,
  ): Promise<T> => {
    const run = tail.then(async () => {
      if (embedded)
        return embedded.transaction(async (tx) =>
          fn(new Repository(tx as Sql)),
        );
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        // Serialize business transitions and ledger appends across gateway instances.
        await client.query("SELECT pg_advisory_xact_lock(20261114)");
        const result = await fn(new Repository(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
    tail = run.catch(() => undefined);
    return run;
  };
  const db = {
    transaction,
    close: async () => {
      await tail;
      if (pool) await pool.end();
      else await embedded!.close();
    },
  };
  await db.transaction(async (repo) => {
    for (const table of tables)
      await repo.sql.query(
        `CREATE TABLE IF NOT EXISTS ${table} (id text PRIMARY KEY, data jsonb NOT NULL)`,
      );
    await repo.sql.query(
      "CREATE TABLE IF NOT EXISTS ledger_events (seq bigint PRIMARY KEY, data jsonb NOT NULL)",
    );
    await repo.sql.query(
      "CREATE TABLE IF NOT EXISTS request_nonces (nonce text PRIMARY KEY, expires_at timestamptz NOT NULL)",
    );
    await repo.sql.query(
      "CREATE TABLE IF NOT EXISTS catalog_products (id text PRIMARY KEY, data jsonb NOT NULL, search tsvector NOT NULL)",
    );
    await repo.sql.query(
      "CREATE INDEX IF NOT EXISTS catalog_search_idx ON catalog_products USING gin(search)",
    );
    await repo.sql.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS proposal_idempotency_idx ON proposals ((data->>'agentId'), (data->>'idempotencyKey'))",
    );
    await repo.sql.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS order_proposal_idx ON orders ((data->>'proposalId'))",
    );
    for (const table of ["offers", "proposals", "orders", "approvals"])
      await repo.sql.query(
        `CREATE INDEX IF NOT EXISTS ${table}_customer_idx ON ${table} ((data->>'customerId'))`,
      );
  });
  return db;
}
