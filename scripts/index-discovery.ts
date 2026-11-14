import "dotenv/config";
import { loadCatalog } from "@aimo/catalog";
import { documentFor, contentHash } from "@aimo/discovery";
import {
  embed,
  embeddingModel,
  normalizeVector,
} from "../packages/discovery/src/ai";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
const stateDir = process.env.STATE_DIR || ".local";
const file = join(stateDir, "discovery-local-embeddings.jsonl");
await mkdir(stateDir, { recursive: true });
const catalog = await loadCatalog(process.env.DATA_DIR || "data");
const existing = new Map<string, string>();
for (const l of (await readFile(file, "utf8").catch(() => "")).split("\n")) {
  try {
    const x = JSON.parse(l);
    if (x.model === embeddingModel) {
      normalizeVector(x.values);
      existing.set(x.id, x.hash);
    }
  } catch {}
}
const pending = catalog.products.filter(
  (p) => existing.get(p.id) !== contentHash(p),
);
const cap = Number(process.env.INDEX_LIMIT || 50);
if (!Number.isSafeInteger(cap) || cap < 1)
  throw new Error("INDEX_LIMIT must be a positive integer");
let added = 0;
for (let i = 0; i < Math.min(cap, pending.length); i += 32) {
  const batch = pending.slice(i, Math.min(i + 32, cap));
  try {
    const v = await embed(batch.map(documentFor), "RETRIEVAL_DOCUMENT");
    await appendFile(
      file,
      batch
        .map((p, j) =>
          JSON.stringify({
            id: p.id,
            hash: contentHash(p),
            model: embeddingModel,
            values: v[j],
          }),
        )
        .join("\n") + "\n",
    );
    added += batch.length;
    console.log(
      `Embedded ${added}/${Math.min(cap, pending.length)}; cached ${catalog.products.length - pending.length + added}/${catalog.products.length}`,
    );
  } catch (e) {
    console.log(
      "Indexing paused; model/cache status",
      (e as { status?: number }).status || "unavailable",
    );
    process.exitCode = 1;
    break;
  }
}
