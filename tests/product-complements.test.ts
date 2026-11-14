import { beforeAll, describe, expect, it } from "vitest";
import type { Offer } from "@aimo/schema";
import { present } from "@aimo/discovery";
import { testCatalog } from "./helpers";
import {
  complementRequests,
  eligibleComplements,
  addComplement,
  complementQuantity,
} from "../apps/web/app/store/complements";
import type { StoreProduct } from "../apps/web/app/store/types";
let pasta: StoreProduct, sauce: StoreProduct;
const date = "2026-11-16";
beforeAll(async () => {
  const catalog = await testCatalog();
  pasta = present(catalog.get("466360"));
  sauce = present(catalog.get("468943"));
});
function offer(p: StoreProduct, amount = 100): Offer {
  return {
    id: `offer-${p.id}`,
    customerId: "test",
    productId: p.id,
    product: p,
    requestedDate: date,
    issuedAt: "2026-11-14T00:00:00Z",
    validUntil: "2026-11-17T00:00:00Z",
    source: "mock",
    price: {
      value: 10,
      currency: "EUR",
      validFrom: "2026-11-14T00:00:00Z",
      validTo: "2026-11-17T00:00:00Z",
      netPriceFound: true,
    },
    salesBlock: false,
    closingTime: null,
    logisticModel: "warehouse",
    availability: [
      {
        availableAmount: amount,
        availableDate: date,
        salesUnit: p.salesUnit,
        salesBlock: false,
      },
    ],
    signature: "test",
  };
}
describe("complementary product recommendations", () => {
  it("uses real recipe links and only labels actual saved co-occurrence as personal history", () => {
    const requests = complementRequests(pasta, []);
    expect(
      requests.some(
        (r) =>
          r.query === sauce.id &&
          r.source?.startsWith("https://www.valioaimo.fi/reseptit/"),
      ),
    ).toBe(true);
    expect(requests.some((r) => r.reason.includes("saved basket"))).toBe(false);
    const saved = [
      [
        { product: pasta, qty: 1 },
        { product: sauce, qty: 1 },
      ],
    ];
    expect(complementRequests(pasta, saved)[0]?.query).toBe(sauce.id);
    expect(complementRequests(pasta, saved)[0]?.reason).toBe(
      "Together in your saved basket",
    );
  });
  it("excludes the viewed product, substitutes, duplicates and items already in the basket", () => {
    const candidates = [
      { product: pasta, query: pasta.id, reason: "fixture" },
      {
        product: { ...pasta, id: "similar" },
        query: "similar",
        reason: "fixture",
      },
      { product: sauce, query: sauce.id, reason: "fixture" },
      { product: sauce, query: sauce.id, reason: "fixture" },
    ];
    const offers = {
      [sauce.id]: offer(sauce),
      [pasta.id]: offer(pasta),
      similar: offer({ ...pasta, id: "similar" }),
    };
    expect(
      eligibleComplements(pasta, candidates, offers, [], [], date).map(
        (c) => c.product.id,
      ),
    ).toEqual([sauce.id]);
    expect(
      eligibleComplements(
        pasta,
        candidates,
        offers,
        [{ product: sauce, qty: 1 }],
        [],
        date,
      ),
    ).toEqual([]);
  });
  it("does not keep pushing another brand of an add-on already chosen", () => {
    const other = { ...sauce, id: "other-sauce" };
    const candidates = [
      { product: sauce, query: "tomato sauce", reason: "For sauce" },
      { product: other, query: "tomato sauce", reason: "For sauce" },
    ];
    const offers = { [sauce.id]: offer(sauce), [other.id]: offer(other) };
    expect(
      eligibleComplements(pasta, candidates, offers, [], [], date),
    ).toHaveLength(1);
    expect(
      eligibleComplements(
        pasta,
        candidates,
        offers,
        [{ product: sauce, qty: 1 }],
        [],
        date,
      ),
    ).toEqual([]);
  });
  it("never promotes unknown stock or unsupported dietary requirements", () => {
    const candidates = [{ product: sauce, query: sauce.id, reason: "fixture" }];
    for (const amount of [0, 999999])
      expect(
        eligibleComplements(
          pasta,
          candidates,
          { [sauce.id]: offer(sauce, amount) },
          [],
          [],
          date,
        ),
      ).toEqual([]);
    expect(
      eligibleComplements(
        pasta,
        candidates,
        { [sauce.id]: offer(sauce) },
        [],
        ["UNDECLARED"],
        date,
      ),
    ).toEqual([]);
    const late = offer(sauce);
    late.availability[0]!.availableDate = "2026-11-17";
    expect(
      eligibleComplements(
        pasta,
        candidates,
        { [sauce.id]: late },
        [],
        [],
        date,
      ),
    ).toEqual([]);
  });
  it("does not turn generic hundredth lots into fractional case recommendations", () => {
    expect(
      complementQuantity({
        ...sauce,
        baseUnit: "KI",
        salesUnit: "KI",
        allowedLotSize: 0.01,
      }),
    ).toBe(1);
    expect(
      complementQuantity({
        ...sauce,
        baseUnit: "KI",
        salesUnit: "KI",
        allowedLotSize: 0.3,
      }),
    ).toBe(3);
    const p = {
      ...sauce,
      baseUnit: "KI",
      salesUnit: "KI",
      allowedLotSize: 0.01,
    };
    expect(
      eligibleComplements(
        pasta,
        [{ product: p, query: p.id, reason: "fixture" }],
        { [p.id]: offer(p, 0.5) },
        [],
        [],
        date,
      ),
    ).toEqual([]);
  });
  it("adds one legal purchase step explicitly and preserves existing requirements and lines", () => {
    const p = {
      ...sauce,
      claims: [...sauce.claims, "VEGAN"],
      baseUnit: "ST",
      allowedLotSize: 0.5,
    };
    const cart = [
      { product: pasta, qty: 3 },
      { product: p, qty: 2, requiredClaims: ["VEGAN"] },
    ];
    const next = addComplement(cart, p, []);
    expect(next[0]).toEqual(cart[0]);
    expect(next[1]?.qty).toBe(3);
    expect(next[1]?.requiredClaims).toContain("VEGAN");
    expect(cart[1]?.qty).toBe(2);
    expect(() => addComplement(cart, { ...p, claims: [] }, [])).toThrow(
      /dietary/,
    );
  });
});
