import { describe, it, expect, beforeAll } from "vitest";
import { testCatalog, now } from "./helpers.js";
import type { Catalog } from "@aimo/catalog";
import {
  convertRequirement,
  isLotMultiple,
  lineCents,
  toInstant,
} from "@aimo/feasibility";
let catalog: Catalog;
beforeAll(async () => {
  catalog = await testCatalog();
});
describe("supplied data and conservative normalization", () => {
  it("ingests the complete catalog with valid unit and lot metadata", () => {
    expect(catalog.products).toHaveLength(17546);
    expect(
      catalog.products.every(
        (p) =>
          p.salesUnit &&
          p.allowedLotSize > 0 &&
          p.packs.every((u) => u.sizeInBaseUnits > 0),
      ),
    ).toBe(true);
  });
  it("finds the reference lactose-free milk in the top three", () => {
    expect(
      catalog
        .search({
          query: "lactose-free milk",
          claims: [],
          allergenFree: [],
          limit: 3,
        })
        .map((p) => p.id),
    ).toContain("464201");
  });
  it("uses the actual yoghurt from the dataset", () => {
    expect(catalog.get("476824").names.fi).toContain("jogurtti");
    expect(catalog.get("469363").names.fi).toContain("maito");
  });
  it("retains missing carbon and reliability as absent", () => {
    expect(catalog.products.some((p) => p.carbonKgPerKg === undefined)).toBe(
      true,
    );
    expect(catalog.products.some((p) => p.reliability === undefined)).toBe(
      true,
    );
  });
  it("requires positive declarations when filtering substitutes", () => {
    const result = catalog.substitutes(
      "464201",
      ["FREE_FROM_LACTOSE"],
      ["AE"],
      100,
    );
    expect(result.length).toBeGreaterThan(0);
    expect(
      result.every(
        (p) =>
          p.product.claims.includes("FREE_FROM_LACTOSE") &&
          p.product.allergenFree.includes("AE"),
      ),
    ).toBe(true);
  });
  it("does not equate lactose-free with milk-allergen-free", () => {
    const milk = catalog.get("464201");
    expect(milk.claims).toContain("FREE_FROM_LACTOSE");
    expect(milk.allergens).toContain("AM");
    expect(milk.allergenFree).not.toContain("AM");
  });
});
describe("quantity and money decisions", () => {
  it("converts 1,000 litres to 1,000 ST and 100 KI", () => {
    expect(convertRequirement(catalog.get("464201"), 1000, "L")).toMatchObject({
      qty: 1000,
      salesUnit: "ST",
      cases: 100,
      roundedUp: false,
      inferred: false,
    });
  });
  it("uses the sales-pack factor for a product sold by the case", () => {
    const butter = catalog.get("476584");
    expect(convertRequirement(butter, 60, "KG").qty).toBe(6);
  });
  it("does not turn a kg-priced fish box into ten times the quantity", () => {
    expect(convertRequirement(catalog.get("461885"), 150, "KG").qty).toBe(150);
  });
  it("rounds packaged products up to whole pieces", () => {
    expect(convertRequirement(catalog.get("464201"), 1.1, "L")).toMatchObject({
      qty: 2,
      roundedUp: true,
    });
  });
  it("refuses unknown content conversion instead of guessing", () => {
    expect(() =>
      convertRequirement(
        { ...catalog.get("464201"), netContent: undefined },
        10,
        "L",
      ),
    ).toThrow("Cannot safely convert");
  });
  it("uses decimal lot arithmetic and rounds monetary lines half-up", () => {
    expect(isLotMultiple(0.3, 0.1)).toBe(true);
    expect(isLotMultiple(10, 3)).toBe(false);
    expect(lineCents(3, 0.335)).toBe(101);
  });
  it("interprets offsetless supplier times in Helsinki, including DST", () => {
    expect(toInstant("2026-11-14T12:00:00")).toBe(now.toISOString());
    expect(toInstant("2026-06-14T12:00:00")).toBe("2026-06-14T09:00:00.000Z");
  });
});
