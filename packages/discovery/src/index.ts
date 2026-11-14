import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Catalog } from "@aimo/catalog";
import type { Product } from "@aimo/schema";
import { DomainError } from "@aimo/schema";
import {
  embed,
  interpret,
  type Intent,
  normalizeVector,
  embeddingModel,
} from "./ai";
import {
  searchInput,
  normalize,
  name,
  groupFor,
  productType,
  present,
  hasClaim,
  documentFor,
  claimLabels,
  type SearchRequest,
} from "./model";
export * from "./model";
export const contentHash = (p: Product) =>
  createHash("sha256").update(documentFor(p)).digest("hex");
const synonyms: Record<string, string> = {
  kerma: "cream",
  ruokakerma: "cooking cream",
  kuohukerma: "whipping cream",
  maito: "milk",
  voi: "butter",
  juusto: "cheese",
  jogurtti: "yogurt",
  peruna: "potato",
  kananmuna: "egg",
  jauho: "flour",
  kana: "chicken",
  lohi: "salmon",
  jogurt: "yogurt",
  yoghurt: "yogurt",
  tomaatit: "tomatoes",
  tomaatti: "tomato",
  penne: "penne",
  laktoositon: "lactose free",
  gluteeniton: "gluten free",
  vegaaninen: "vegan",
};
export function basicIntent(query: string): Intent {
  let q = normalize(query);
  const claims: Intent["claims"] = [];
  const unresolved: string[] = [];
  if (
    /\b(not|without|no)\s+(lactose free|gluten free|vegan|organic|vegetarian)|\b(non vegan)\b/.test(
      q,
    )
  )
    unresolved.push("Negative dietary preference needs review.");
  if (
    /\b(nut free|peanut free|dairy free|milk free|allergy|allergies|allergen|allergens|pahkinaton|maidoton)\b/.test(
      q,
    )
  )
    unresolved.push(
      "This allergen restriction needs explicit supplier evidence.",
    );
  if (
    /\b(without|except|exclude|excluding|avoid|avoiding|no|not|less|under|below|tomorrow|today|budget|sugar free|low fat|halal|kosher)\b/.test(
      q,
    ) ||
    /[€$]/.test(query)
  )
    unresolved.push(
      "This extra requirement cannot be applied automatically. Edit your search or use the product details to check it.",
    );
  for (const [rx, claim] of [
    [/\b(lactose free|lactosefree|laktoositon)\b/, "FREE_FROM_LACTOSE"],
    [/\b(gluten free|glutenfree|gluteeniton)\b/, "FREE_FROM_GLUTEN"],
    [/\b(vegan|vegaaninen)\b/, "VEGAN"],
    [/\b(organic|luomu)\b/, "ORGANIC"],
    [/\bvegetarian\b/, "VEGETARIAN"],
  ] as const)
    if (rx.test(q)) {
      if (!unresolved.some((x) => x.startsWith("Negative"))) claims.push(claim);
      q = q.replace(rx, " ");
    }
  if (/\bfree\b/.test(q))
    unresolved.push(
      "This free-from requirement is not supported by an explicit catalogue filter.",
    );
  const preferredPack =
    query
      .toLowerCase()
      .match(
        /\b\d+(?:[.,]\d+)?\s*(?:kg|litres?|liters?|litre|liter|l|g|ml)\b/,
      )?.[0] ?? null;
  q = q.replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|litres?|liters?|l|g|ml)\b/g, " ");
  q = q.replace(
    /\b(i|need|want|please|find|show|me|some|for|around|about|a|an|the|of|products?|by|tomorrow)\b/g,
    " ",
  );
  const terms = q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => synonyms[t] || t);
  return { terms, claims, preferredPack, unresolved };
}
export class Discovery {
  private db = new PGlite({ extensions: { vector, pg_trgm } });
  private ready: Promise<void>;
  private embedded = 0;
  private hashes = new Map<string, string>();
  private mtime = 0;
  private refreshing?: Promise<void>;
  private cache = new Map<
    string,
    { at: number; intent: Intent; vector?: number[]; mode: string }
  >();
  constructor(
    readonly catalog: Catalog,
    private embeddingPath?: string,
  ) {
    this.hashes = new Map(catalog.products.map((p) => [p.id, contentHash(p)]));
    this.ready = this.init();
  }
  private async init() {
    await this.db.exec(
      `CREATE EXTENSION vector; CREATE EXTENSION pg_trgm; CREATE TABLE products(id text PRIMARY KEY, label text, words text, group_name text, brand text, category text, claims text[], body tsvector); CREATE TABLE vectors(id text PRIMARY KEY, embedding vector(384));`,
    );
    for (let start = 0; start < this.catalog.products.length; start += 500) {
      const batch = this.catalog.products
        .slice(start, start + 500)
        .map((p) => ({
          id: p.id,
          label: normalize(`${name(p)} ${p.names.fi || ""}`),
          words: normalize(
            `${p.id} ${p.gtin || ""} ${p.packs.map((x) => x.gtin || "").join(" ")} ${name(p)} ${p.names.fi || ""} ${p.brand}`,
          ),
          group: groupFor(p),
          brand: p.brand,
          category: p.category,
          claims: p.claims.filter((c) => hasClaim(p, c)),
          extra: normalize(documentFor(p)),
        }));
      await this.db.query(
        `INSERT INTO products SELECT x->>'id',x->>'label',x->>'words',x->>'group',x->>'brand',x->>'category',ARRAY(SELECT jsonb_array_elements_text(x->'claims')),setweight(to_tsvector('simple',x->>'words'),'A')||setweight(to_tsvector('simple',x->>'extra'),'C') FROM jsonb_array_elements($1::jsonb) x`,
        [JSON.stringify(batch)],
      );
    }
    await this.db.exec(
      "CREATE INDEX search_words ON products USING gin(body); CREATE INDEX name_trigrams ON products USING gin(label gin_trgm_ops);",
    );
    await this.refresh();
  }
  async close() {
    await this.ready;
    await this.db.close();
  }
  private async refresh() {
    if (!this.embeddingPath) return;
    const path = this.embeddingPath;
    const info = await stat(path).catch(() => undefined);
    if (!info || info.mtimeMs === this.mtime) return;
    const records = (await readFile(path, "utf8"))
      .split("\n")
      .flatMap((line) => {
        try {
          const r = JSON.parse(line);
          const p = this.catalog.byId.get(r.id);
          if (
            p &&
            r.model === embeddingModel &&
            r.hash === this.hashes.get(p.id)
          )
            return [{ id: r.id, v: normalizeVector(r.values) }];
        } catch {}
        return [];
      });
    const complete = [...new Map(records.map((r) => [r.id, r])).values()];
    // Activate a complete version atomically; never bias search toward a partial batch.
    if (complete.length !== this.catalog.products.length) {
      this.mtime = info.mtimeMs;
      return;
    }
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < complete.length; i += 500)
        await tx.query(
          `INSERT INTO vectors SELECT x->>'id',(x->>'v')::vector FROM jsonb_array_elements($1::jsonb) x ON CONFLICT(id) DO UPDATE SET embedding=EXCLUDED.embedding`,
          [JSON.stringify(complete.slice(i, i + 500))],
        );
    });
    this.embedded = complete.length;
    this.mtime = info.mtimeMs;
    this.cache.clear();
  }
  async search(raw: unknown) {
    const input = searchInput.parse(raw);
    await this.ready;
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    await this.refreshing;
    let intent = basicIntent(input.query);
    let queryVector: number[] | undefined;
    let mode = "basic";
    const exact = input.query
      ? this.catalog.products.find(
          (p) =>
            p.id === input.query ||
            p.gtin === input.query ||
            p.packs.some((x) => x.gtin === input.query),
        )
      : undefined;
    const numericIdentifier = /^\d{6,}$/.test(input.query);
    if (input.smart && input.query && !exact && !numericIdentifier) {
      const cached = this.cache.get(input.query);
      if (cached && Date.now() - cached.at < 300000) {
        intent = cached.intent;
        queryVector = cached.vector;
        mode = cached.mode;
      } else {
        const [a, b] = await Promise.allSettled([
          interpret(input.query),
          this.embedded === this.catalog.products.length
            ? embed([input.query], "RETRIEVAL_QUERY")
            : Promise.resolve(undefined),
        ]);
        if (a.status === "fulfilled") {
          intent = {
            ...a.value,
            claims: [...new Set([...intent.claims, ...a.value.claims])],
            unresolved: [
              ...new Set([...intent.unresolved, ...a.value.unresolved]),
            ],
          };
          mode = "ai";
        }
        if (b.status === "fulfilled" && b.value) {
          queryVector = b.value[0];
          mode = mode === "ai" ? "hybrid" : "semantic";
        }
        if (this.cache.size > 200) this.cache.clear();
        this.cache.set(input.query, {
          at: Date.now(),
          intent,
          vector: queryVector,
          mode,
        });
      }
    }
    const claims = [...new Set([...input.claims, ...intent.claims])];
    const terms = intent.terms
      .flatMap((t) => normalize(t).split(" "))
      .filter(Boolean);
    const lexical = terms
      .map((t) => t.replace(/[^a-z0-9]/g, ""))
      .filter(Boolean)
      .map((t) => `${t}:*`)
      .join(" & ");
    const q = terms.join(" ");
    const params: unknown[] = [
      input.group,
      input.brand || "",
      input.category || "",
      claims,
      q,
      lexical,
    ];
    const where = `($1='All products' OR group_name=$1) AND ($2='' OR brand=$2) AND ($3='' OR category=$3) AND claims @> $4::text[]`;
    let rows: { id: string; score: number }[] = [];
    if (!intent.unresolved.length && (!numericIdentifier || exact)) {
      if (exact)
        rows =
          claims.every((c) => hasClaim(exact, c)) &&
          (input.group === "All products" || groupFor(exact) === input.group) &&
          (!input.brand || exact.brand === input.brand) &&
          (!input.category || exact.category === input.category)
            ? [{ id: exact.id, score: 1000 }]
            : [];
      else if (!q)
        rows = (
          await this.db.query<{ id: string; score: number }>(
            `SELECT id,0::float AS score FROM products WHERE ${where} ORDER BY label,id`,
            params.slice(0, 4),
          )
        ).rows;
      else
        rows = (
          await this.db.query<{ id: string; score: number }>(
            `SELECT id, ts_rank_cd(body,to_tsquery('simple',$6))*8+similarity(label,$5)*2+CASE WHEN label LIKE '%'||$5||'%' THEN 4 ELSE 0 END AS score FROM products WHERE ${where} AND (body @@ to_tsquery('simple',$6) OR word_similarity($5,label)>0.55) ORDER BY score DESC,id`,
            params,
          )
        ).rows;
      if (queryVector && q) {
        const semantic = (
          await this.db.query<{ id: string; distance: number }>(
            `SELECT id,embedding <=> $5::vector AS distance FROM products JOIN vectors USING(id) WHERE ${where} ORDER BY distance LIMIT 150`,
            [...params.slice(0, 4), JSON.stringify(queryVector)],
          )
        ).rows.filter((r) => r.distance < 0.38);
        const scores = new Map(rows.map((r, i) => [r.id, 1 / (60 + i + 1)]));
        semantic.forEach((r, i) =>
          scores.set(r.id, (scores.get(r.id) || 0) + 1 / (60 + i + 1)),
        );
        rows = [...scores]
          .map(([id, score]) => ({ id, score }))
          .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      }
    }
    // Explicit product-type interpretation outranks incidental textual mentions.
    const desired = [
      "cooking cream",
      "whipping cream",
      "coffee cream",
      "milk",
      "butter",
      "yogurt",
      "pasta",
    ].find((t) => q === t || q.includes(t));
    const packMatch = intent.preferredPack
      ?.toLowerCase()
      .match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|litre|liter)/);
    const preferredAmount = packMatch
      ? Number(packMatch[1]!.replace(",", ".")) /
        (["g", "ml"].includes(packMatch[2]!) ? 1000 : 1)
      : null;
    const preferredUnit = packMatch
      ? ["kg", "g"].includes(packMatch[2]!)
        ? "KG"
        : "L"
      : null;
    const packDistance = (id: string) => {
      const p = this.catalog.get(id),
        n = p.netContent;
      return preferredAmount && n && !n.inferred && n.unit === preferredUnit
        ? Math.abs(Math.log(n.value / preferredAmount))
        : Number.POSITIVE_INFINITY;
    };
    const broadCream = q === "cream";
    if ((desired || broadCream) && !exact)
      rows.sort(
        (a, b) =>
          Number(
            broadCream
              ? productType(this.catalog.get(b.id)).endsWith("cream")
              : productType(this.catalog.get(b.id)) === desired,
          ) -
            Number(
              broadCream
                ? productType(this.catalog.get(a.id)).endsWith("cream")
                : productType(this.catalog.get(a.id)) === desired,
            ) ||
          (preferredAmount ? packDistance(a.id) - packDistance(b.id) : 0) ||
          b.score - a.score ||
          a.id.localeCompare(b.id),
      );
    const brandCounts = new Map<string, number>();
    const groupCounts = new Map<string, number>();
    for (const r of rows) {
      const p = this.catalog.get(r.id);
      if (p.brand)
        brandCounts.set(p.brand, (brandCounts.get(p.brand) || 0) + 1);
      const g = groupFor(p);
      groupCounts.set(g, (groupCounts.get(g) || 0) + 1);
    }
    const page = rows
      .slice((input.page - 1) * input.limit, input.page * input.limit)
      .map((r) => {
        const p = this.catalog.get(r.id);
        return present(
          p,
          claims.map((c) => `Supplier-declared ${claimLabels[c] || c}`),
        );
      });
    const refinements =
      q === "cream"
        ? ["Cooking cream", "Whipping cream", "Coffee cream"]
        : q === "milk"
          ? ["Lactose-free milk", "Organic milk", "Oat drink"]
          : [];
    return {
      products: page,
      total: rows.length,
      catalogCount: this.catalog.products.length,
      page: input.page,
      pages: Math.ceil(rows.length / input.limit),
      mode,
      embeddingCount: this.embedded,
      intent,
      filters: { claims, group: input.group, brand: input.brand || "" },
      facets: {
        brands: [...brandCounts].sort((a, b) => b[1] - a[1]).slice(0, 40),
        groups: [...groupCounts],
      },
      refinements,
      unresolved: intent.unresolved,
    };
  }
  compare(ids: string[]) {
    if (ids.length < 1 || ids.length > 3)
      throw new DomainError("INVALID_COMPARE", "Choose up to three products");
    return { products: ids.map((id) => present(this.catalog.get(id))) };
  }
  alternatives(id: string) {
    const source = this.catalog.get(id);
    const type = productType(source);
    const candidates = this.catalog.products.filter(
      (p) =>
        p.id !== id &&
        (source.substitutions.includes(p.id) ||
          (type !== "other" &&
            productType(p) === type &&
            p.category === source.category)) &&
        source.claims
          .filter(
            (c) =>
              c.startsWith("FREE_FROM_") || ["VEGAN", "VEGETARIAN"].includes(c),
          )
          .every((c) => hasClaim(p, c)) &&
        source.allergenFree.every(
          (c) => p.allergenFree.includes(c) && !p.allergens.includes(c),
        ),
    );
    return {
      source: present(source),
      products: candidates
        .sort(
          (a, b) =>
            Number(source.substitutions.includes(b.id)) -
              Number(source.substitutions.includes(a.id)) ||
            a.id.localeCompare(b.id),
        )
        .slice(0, 24)
        .map((p) =>
          present(p, [
            source.substitutions.includes(p.id)
              ? "Supplier-listed substitute"
              : "Same product type · check recipe suitability",
          ]),
        ),
      total: candidates.length,
    };
  }
}
