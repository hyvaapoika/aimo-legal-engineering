import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDatabase } from "@aimo/database";
import { configuration } from "../apps/gateway/src/config.js";
import { importDeclaration } from "../apps/gateway/src/supplier-declarations.js";

const file = process.argv[2];
if (!file)
  throw new Error("Usage: pnpm evidence:import <supplier-declaration.json>");
const record: unknown = JSON.parse(await readFile(file, "utf8"));
const config = configuration();
const db = await createDatabase(
  config.databaseUrl,
  join(config.stateDir, "db"),
);
try {
  const saved = await importDeclaration(db, record, new Date());
  console.log(
    `Recorded ${saved.documentId} revision ${saved.revision} for ${saved.productId}.`,
  );
} finally {
  await db.close();
}
