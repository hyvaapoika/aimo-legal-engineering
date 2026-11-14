import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import {
  Discovery,
  basicIntent,
  present,
  packLabel,
  productType,
} from "@aimo/discovery";
import { testCatalog } from "./helpers";
import {
  cents,
  replacement,
  purchaseStep,
  restoreLines,
} from "../apps/web/app/store/cart";
import { stock } from "../apps/web/app/store/types";
import type { Offer } from "@aimo/schema";
let discovery: Discovery;
let catalog: Awaited<ReturnType<typeof testCatalog>>;
beforeAll(async () => {
  catalog = await testCatalog();
  discovery = new Discovery(catalog);
});
afterAll(async () => {
  await discovery.close();
});
describe("Grounded full catalogue discovery", () => {
  it("paginates all supplied records with no overlap", async () => {
    const a = await discovery.search({}),
      b = await discovery.search({ page: 2 });
    expect(a.total).toBe(17546);
    expect(a.products).toHaveLength(24);
    expect(a.products.some((p) => b.products.some((x) => x.id === p.id))).toBe(
      false,
    );
  });
  it("finds exact IDs and GTINs before advisory search", async () => {
    const p = catalog.get("464249");
    for (const query of [p.id, p.gtin!]) {
      const r = await discovery.search({ query, smart: true });
      expect(r.products.map((x) => x.id)).toEqual([p.id]);
      expect(r.mode).toBe("basic");
    }
  });
  it("does not fuzzy-match an unknown numeric identifier to pack sizes", async () => {
    expect(
      (await discovery.search({ query: "0000000000000000000", smart: true }))
        .total,
    ).toBe(0);
  });
  it("prioritizes actual cream over incidental cream descriptions in both languages", async () => {
    for (const query of ["cream", "kerma"]) {
      const r = await discovery.search({ query });
      expect(
        r.products.slice(0, 5).every((p) => productType(p).endsWith("cream")),
      ).toBe(true);
      expect(r.refinements).toContain("Cooking cream");
    }
  });
  it("does not classify milk-system cleaning products as drinking milk", () => {
    const cleaners = catalog.products.filter((p) =>
      /milk.*clean|clean.*milk/i.test(p.names.en || ""),
    );
    expect(cleaners.length).toBeGreaterThan(0);
    expect(cleaners.every((p) => productType(p) === "other")).toBe(true);
  });
  it("applies dietary filters before retrieval and never guesses absent evidence", async () => {
    for (const query of ["gluten-free pasta", "laktoositon maito"]) {
      const r = await discovery.search({ query });
      expect(r.total).toBeGreaterThan(0);
      expect(
        r.products.every((p) =>
          r.filters.claims.every((c) => p.claims.includes(c)),
        ),
      ).toBe(true);
    }
    const p = catalog.products.find((p) => !p.claims.includes("VEGAN"))!;
    expect(
      (await discovery.search({ query: p.id, claims: ["VEGAN"] })).total,
    ).toBe(0);
  });
  it.each([
    "not vegan milk",
    "no organic milk",
    "nut-free milk",
    "without peanuts",
    "cream under €3",
    "milk tomorrow",
    "free of nuts",
    "avoid peanuts",
  ])("does not silently ignore unsupported constraint %s", async (query) => {
    expect(basicIntent(query).unresolved.length).toBeGreaterThan(0);
    expect((await discovery.search({ query })).total).toBe(0);
  });
  it("keeps SQL-looking input as data and rejects unknown request fields", async () => {
    await discovery.search({ query: "'; DROP TABLE products;--" });
    expect((await discovery.search({})).total).toBe(17546);
    expect((await discovery.search({ query: "milk" })).total).toBeGreaterThan(
      0,
    );
    await expect(
      discovery.search({ query: "milk", ignoreDietary: true }),
    ).rejects.toThrow();
  });
  it("preserves declared dietary and allergen requirements in alternatives", () => {
    const { source, products } = discovery.alternatives("464249");
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      expect(
        source.claims
          .filter((c) => c.startsWith("FREE_FROM_"))
          .every((c) => p.claims.includes(c)),
      ).toBe(true);
      expect(
        source.allergenFree.every(
          (c) => p.allergenFree.includes(c) && !p.allergens.includes(c),
        ),
      ).toBe(true);
    }
    expect(() => discovery.compare(["forged-product"])).toThrow();
    expect(() =>
      discovery.compare(["464249", "464249", "464249", "464249"]),
    ).toThrow();
  });
  it("falls back with constraints intact when AI is unavailable", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    try {
      const r = await discovery.search({
        query: "lactose-free milk",
        smart: true,
      });
      expect(r.mode).toBe("basic");
      expect(r.products.length).toBeGreaterThan(0);
      expect(
        r.products.every((p) => p.claims.includes("FREE_FROM_LACTOSE")),
      ).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
describe("Shopping trust and conversion boundaries", () => {
  it("never displays inferred contents as verified", () => {
    const p = catalog.get("464249");
    expect(
      packLabel({ ...p, netContent: { value: 1, unit: "L", inferred: true } })
        .content,
    ).toBeNull();
  });
  it("uses legal whole-pack increments and exact money rounding", () => {
    const p = catalog.get("464249");
    expect(purchaseStep({ ...p, baseUnit: "ST", allowedLotSize: 0.03 })).toBe(
      3,
    );
    expect(purchaseStep({ ...p, baseUnit: "KG", allowedLotSize: 0.25 })).toBe(
      0.25,
    );
    expect(cents(1, 1.005)).toBe(101);
  });
  it("rounds replacement packs up and refuses unknown or incompatible quantities", () => {
    const p = present(catalog.get("464249"));
    const a = { ...p, pack: { ...p.pack, content: { value: 1, unit: "L" } } },
      b = {
        ...p,
        allowedLotSize: 1,
        pack: { ...p.pack, content: { value: 0.75, unit: "L" } },
      };
    expect(replacement({ product: a, qty: 2 }, b)).toEqual({
      qty: 3,
      excess: 0.25,
      unit: "L",
    });
    expect(
      replacement(
        { product: a, qty: 2 },
        { ...b, pack: { ...b.pack, content: null } },
      ),
    ).toBeNull();
    expect(
      replacement(
        { product: a, qty: 2 },
        { ...b, pack: { ...b.pack, content: { value: 1, unit: "KG" } } },
      ),
    ).toBeNull();
    expect(
      replacement(
        { product: a, qty: 2, requiredClaims: ["VEGAN"] },
        { ...b, claims: [] },
      ),
    ).toBeNull();
  });
  it("preserves unknown stock and delivery evidence", () => {
    const o = {
      product: catalog.get("464249"),
      availability: [
        {
          availableAmount: 999999,
          salesUnit: "ST",
          availableDate: "2026-11-16",
        },
      ],
    } as Offer;
    expect(stock(o, "2026-11-16").status).toBe("unknown");
    expect(stock({ ...o, availability: [] }, "2026-11-16").status).toBe(
      "unknown",
    );
    expect(stock({ ...o, salesBlock: true }, "2026-11-16").status).toBe(
      "blocked",
    );
  });
  it("ignores malformed browser storage and rebuilds derived contents", () => {
    expect(restoreLines([{ product: { id: "464249" }, qty: 1 }])).toEqual([]);
    const p = present(catalog.get("464249"));
    const restored = restoreLines([
      {
        product: { ...p, pack: { content: { value: 999999, unit: "L" } } },
        qty: 1,
      },
    ]);
    expect(restored[0]?.product.pack.content?.value).not.toBe(999999);
  });
});
