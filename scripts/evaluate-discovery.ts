import { loadCatalog } from "@aimo/catalog";
import { Discovery } from "@aimo/discovery";
import { writeFile, mkdir } from "node:fs/promises";
// Fixed developer-reviewed product-name expectations. A smoke benchmark, not a chef relevance study.
const cases: [string, string][] = [
  ["milk", "milk"],
  ["maito", "milk"],
  ["cooking cream", "cooking cream"],
  ["ruokakerma", "cooking cream"],
  ["whipping cream", "whipping cream"],
  ["kuohukerma", "whipping cream"],
  ["butter", "butter"],
  ["voi", "butter"],
  ["cheese", "cheese"],
  ["juusto", "cheese"],
  ["yogurt", "yogurt|yoghurt"],
  ["jogurtti", "yogurt|yoghurt"],
  ["potato", "potato"],
  ["peruna", "potato"],
  ["chicken", "chicken"],
  ["kana", "chicken"],
  ["salmon", "salmon"],
  ["lohi", "salmon"],
  ["flour", "flour"],
  ["jauho", "flour"],
  ["egg", "egg"],
  ["kananmuna", "egg"],
  ["tomato", "tomato"],
  ["tomaatti", "tomato"],
  ["peanuts", "peanut"],
  ["penne", "penne"],
  ["spaghetti", "spaghetti"],
  ["rice", "rice"],
  ["olive oil", "olive oil"],
  ["black pepper", "black pepper"],
  ["coffee", "coffee"],
  ["orange juice", "orange juice"],
  ["carrot", "carrot"],
  ["broccoli", "broccoli"],
  ["cucumber", "cucumber"],
  ["bread", "bread"],
  ["beef", "beef"],
  ["bacon", "bacon"],
  ["lactose-free milk", "milk"],
  ["gluten-free pasta", "pasta|penne|macaroni|spaghetti|fusilli"],
];
const catalog = await loadCatalog("data");
const semantic = process.argv.includes("--semantic");
// Isolate local embedding quality; no external provider calls in this evaluation.
process.env.GEMINI_API_KEY = "";
const discovery = new Discovery(
  catalog,
  semantic ? ".local/discovery-local-embeddings.jsonl" : undefined,
);
await discovery.search({ query: "464249" });
const rows = [];
for (const [query, pattern] of cases) {
  const start = performance.now();
  const r = await discovery.search({ query, smart: semantic, limit: 5 });
  rows.push({
    query,
    mode: r.mode,
    total: r.total,
    milliseconds: Math.round(performance.now() - start),
    hit: r.products.some((p) =>
      new RegExp(pattern, "i").test(p.names.en || p.names.fi || ""),
    ),
    claimsValid: r.products.every((p) =>
      r.filters.claims.every((c) => p.claims.includes(c)),
    ),
    top5: r.products.map((p) => ({ id: p.id, name: p.names.en || p.names.fi })),
  });
}
await discovery.close();
await mkdir(".local", { recursive: true });
const times = rows.map((r) => r.milliseconds).sort((a, b) => a - b);
const report = {
  mode: semantic ? "local-semantic" : "lexical",
  queries: cases.length,
  top5NameHits: rows.filter((r) => r.hit).length,
  claimViolations: rows.filter((r) => !r.claimsValid).length,
  p50ms: times[Math.floor(times.length * 0.5)],
  p95ms: times[Math.floor(times.length * 0.95)],
  rows,
};
await writeFile(
  `.local/discovery-eval-${report.mode}.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({ ...report, rows: rows.filter((r) => !r.hit) }, null, 2),
);
