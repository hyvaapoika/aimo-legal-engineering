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
import { basicIntent } from "./intent";
export { basicIntent } from "./intent";
export class Discovery {
  private db?: import("@electric-sql/pglite").PGlite;
  private ready?: Promise<void>;
  private embedded = 0;
  private hashes?: Map<string, string>;
  private mtime = 0;
  private refreshing?: Promise<void>;
  private cache = new Map<
    string,
    { at: number; intent: Intent; vector?: number[]; mode: string }
  >();
  constructor(
    readonly catalog: Catalog,
    private embeddingPath?: string,
  ) {}
  private ensureReady() {
    return (this.ready ??= this.init());
  }
  private async init() {
    const [{ PGlite }, { vector }, { pg_trgm }] = await Promise.all([
      import("@electric-sql/pglite"),
      import("@electric-sql/pglite/vector"),
      import("@electric-sql/pglite/contrib/pg_trgm"),
    ]);
    const db = (this.db = new PGlite({ extensions: { vector, pg_trgm } }));
    await db.exec(
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
      await db.query(
        `INSERT INTO products SELECT x->>'id',x->>'label',x->>'words',x->>'group',x->>'brand',x->>'category',ARRAY(SELECT jsonb_array_elements_text(x->'claims')),setweight(to_tsvector('simple',x->>'words'),'A')||setweight(to_tsvector('simple',x->>'extra'),'C') FROM jsonb_array_elements($1::jsonb) x`,
        [JSON.stringify(batch)],
      );
    }
    await db.exec(
      "CREATE INDEX search_words ON products USING gin(body); CREATE INDEX name_trigrams ON products USING gin(label gin_trgm_ops);",
    );
    await this.refresh();
  }
  async close() {
    if (!this.ready) return;
    await this.ready;
    await this.db?.close();
  }
  private async refresh() {
    if (!this.embeddingPath) return;
    const path = this.embeddingPath;
    const info = await stat(path).catch(() => undefined);
    if (!info || info.mtimeMs === this.mtime) return;
    const hashes = (this.hashes ??= new Map(
      this.catalog.products.map((p) => [p.id, contentHash(p)]),
    ));
    const records = (await readFile(path, "utf8"))
      .split("\n")
      .flatMap((line) => {
        try {
          const r = JSON.parse(line);
          const p = this.catalog.byId.get(r.id);
          if (
            p &&
            r.model === embeddingModel &&
            r.hash === hashes.get(p.id)
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
    await this.db!.transaction(async (tx) => {
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
    await this.ensureReady();
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
          await this.db!.query<{ id: string; score: number }>(
            `SELECT id,0::float AS score FROM products WHERE ${where} ORDER BY label,id`,
            params.slice(0, 4),
          )
        ).rows;
      else
        rows = (
          await this.db!.query<{ id: string; score: number }>(
            `SELECT id, ts_rank_cd(body,to_tsquery('simple',$6))*8+similarity(label,$5)*2+CASE WHEN label LIKE '%'||$5||'%' THEN 4 ELSE 0 END AS score FROM products WHERE ${where} AND (body @@ to_tsquery('simple',$6) OR word_similarity($5,label)>0.55) ORDER BY score DESC,id`,
            params,
          )
        ).rows;
      if (queryVector && q) {
        const semantic = (
          await this.db!.query<{ id: string; distance: number }>(
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
    return this.finish(input, intent, rows, mode, !!exact);
  }
  private finish(
    input: SearchRequest,
    intent: Intent,
    rows: { id: string; score: number }[],
    mode: string,
    exact = false,
  ) {
    const q = intent.terms
      .flatMap((t) => normalize(t).split(" "))
      .filter(Boolean)
      .join(" ");
    const claims = [...new Set([...input.claims, ...intent.claims])];
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
  // Keystroke path: no database initialization, vector reads, or provider calls.
  suggest(raw: unknown) {
    const input = searchInput.parse(raw);
    return this.quickSearch(input, basicIntent(input.query), "instant");
  }
  // Railway uses this bounded path so a full in-memory SQL index cannot starve
  // the co-hosted storefront. AI may reinterpret the query; products remain
  // grounded in the loaded catalogue and deterministic filters.
  async searchLightweight(raw: unknown) {
    const input = searchInput.parse(raw);
    let intent = basicIntent(input.query);
    let mode = "instant";
    if (
      input.smart &&
      input.query &&
      !/^\d{6,}$/.test(input.query) &&
      !this.catalog.products.some(
        (p) =>
          p.id === input.query ||
          p.gtin === input.query ||
          p.packs.some((x) => x.gtin === input.query),
      )
    ) {
      try {
        const interpreted = await interpret(input.query);
        intent = {
          ...interpreted,
          claims: [...new Set([...intent.claims, ...interpreted.claims])],
          unresolved: [
            ...new Set([...intent.unresolved, ...interpreted.unresolved]),
          ],
        };
        mode = "ai";
      } catch {
        // Deterministic intent remains available when the model is unavailable.
      }
    }
    return this.quickSearch(input, intent, mode);
  }
  private quickSearch(
    input: SearchRequest,
    intent: Intent,
    mode: string,
  ) {
    const required = [...new Set([...input.claims, ...intent.claims])];
    const tokens = intent.terms
      .flatMap((t) => normalize(t).split(" "))
      .filter(Boolean);
    const exact = this.catalog.products.find(
      (p) =>
        input.query &&
        (p.id === input.query ||
          p.gtin === input.query ||
          p.packs.some((x) => x.gtin === input.query)),
    );
    const rows: { id: string; score: number }[] = [];
    if (!intent.unresolved.length && (!/^\d{6,}$/.test(input.query) || exact)) {
      const query = tokens.join(" ");
      const candidates = exact
        ? [exact]
        : this.catalog.matching({
            query,
            category: input.category,
            claims: required,
            allergenFree: [],
            limit: input.limit,
          });
      for (const p of candidates) {
        if (exact && exact.id !== p.id) continue;
        if (
          !required.every((c) => hasClaim(p, c)) ||
          (input.brand && p.brand !== input.brand) ||
          (input.category && p.category !== input.category) ||
          (input.group !== "All products" && groupFor(p) !== input.group)
        )
          continue;
        const label = normalize(name(p));
        rows.push({
          id: p.id,
          score: exact
            ? 1000
            : tokens.reduce(
                (sum, t) => sum + (label.includes(t) ? 10 : 1),
                0,
              ) +
              (tokens.length && label.includes(query) ? 20 : 0),
        });
      }
      rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    }
    return this.finish(input, intent, rows, mode, !!exact);
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
