import { loadCatalog } from "@aimo/catalog";
import { Discovery } from "@aimo/discovery";
import { writeFile } from "node:fs/promises";
const catalog = await loadCatalog("data");
const semantic = process.argv.includes("--semantic");
process.env.GEMINI_API_KEY = "";
const d = new Discovery(
  catalog,
  semantic ? ".local/discovery-local-embeddings.jsonl" : undefined,
);
type Result = Awaited<ReturnType<Discovery["search"]>>;
type Case = { query: string; kind: string; check: (r: Result) => boolean };
const cases: Case[] = [];
for (const id of ["464249", "475797", "465174", "475437"])
  cases.push({
    query: id,
    kind: "exact",
    check: (r) => r.products[0]?.id === id,
  });
for (const id of ["464249", "475797"]) {
  const p = catalog.get(id);
  cases.push({
    query: p.gtin!,
    kind: "exact",
    check: (r) => r.products[0]?.id === id,
  });
  cases.push({
    query: p.names.en!,
    kind: "exact-name",
    check: (r) => r.products.some((x) => x.id === id),
  });
}
for (const [query, type] of [
  ["cream", "cream"],
  ["kerma", "cream"],
  ["milk", "milk"],
  ["maito", "milk"],
  ["butter", "butter"],
  ["voi", "butter"],
  ["yogurt", "yogurt"],
  ["jogurtti", "yogurt"],
])
  cases.push({
    query: query!,
    kind: "bilingual",
    check: (r) => r.products.some((p) => p.type.endsWith(type!)),
  });
for (const [query, type] of [
  ["coocking cream", "cooking cream"],
  ["whiping cream", "whipping cream"],
  ["mlik", "milk"],
  ["buter", "butter"],
  ["yoghurt", "yogurt"],
  ["cream", "cream"],
  ["cream for cooking", "cooking cream"],
  ["cream for whipping", "whipping cream"],
])
  cases.push({
    query: query!,
    kind: "typo-or-use",
    check: (r) => r.products.some((p) => p.type.endsWith(type!)),
  });
for (const [query, claim] of [
  ["lactose-free milk", "FREE_FROM_LACTOSE"],
  ["gluten-free pasta", "FREE_FROM_GLUTEN"],
  ["vegan oat drink", "VEGAN"],
])
  cases.push({
    query: query!,
    kind: "dietary",
    check: (r) =>
      r.products.length > 0 &&
      r.products.every((p) => p.claims.includes(claim!)),
  });
for (const query of [
  "not vegan milk",
  "no organic milk",
  "nut-free milk",
  "free of nuts",
  "milk without peanuts",
])
  cases.push({
    query,
    kind: "unsupported-constraint",
    check: (r) => r.total === 0 && r.unresolved.length > 0,
  });
for (const query of [
  "cooking cream 1 litre",
  "cooking cream around 1 l",
  "milk 1 litre",
  "butter 500 g",
])
  cases.push({
    query,
    kind: "pack",
    check: (r) => r.products.length > 0 && r.intent.preferredPack !== null,
  });
for (const query of ["zzqvnonexistentproduct", "0000000000000000000"])
  cases.push({ query, kind: "no-match", check: (r) => r.total === 0 });
for (const query of ["cream under €3", "milk tomorrow"])
  cases.push({
    query,
    kind: "unsupported-context",
    check: (r) => r.total === 0 && r.unresolved.length > 0,
  });
await d.search({ query: "464249" });
const rows = [];
for (const c of cases) {
  const t = performance.now(),
    r = await d.search({ query: c.query, smart: semantic, limit: 5 });
  rows.push({
    query: c.query,
    kind: c.kind,
    pass: c.check(r),
    mode: r.mode,
    total: r.total,
    ms: Math.round(performance.now() - t),
    ids: r.products.map((p) => p.id),
    names: r.products.map((p) => p.names.en || p.names.fi),
  });
}
await d.close();
const report = {
  mode: semantic ? "local-semantic" : "lexical",
  count: rows.length,
  passed: rows.filter((x) => x.pass).length,
  rows,
};
await writeFile(
  `.local/discovery-challenge-${report.mode}.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({ ...report, rows: rows.filter((x) => !x.pass) }, null, 2),
);
