import { beforeAll, describe, expect, it } from "vitest";
import type { Offer } from "@aimo/schema";
import { present } from "@aimo/discovery";
import { testCatalog } from "./helpers";
import { rankAlternatives } from "../apps/web/app/store/proactive";
import type { StoreProduct } from "../apps/web/app/store/types";
let original: StoreProduct, next: StoreProduct;
const date = "2026-11-20";
beforeAll(async () => {
  const catalog = await testCatalog();
  const p = present(catalog.get("466360"));
  original = {
    ...p,
    id: "source",
    claims: ["FREE_FROM_LACTOSE"],
    allergenFree: [],
    pack: { ...p.pack, content: { value: 1, unit: "KG" } },
  };
  next = {
    ...original,
    id: "next",
    pack: { ...p.pack, content: { value: 0.2, unit: "KG" } },
  };
});
function offer(product: StoreProduct, price: number, amount = 100): Offer {
  return {
    id: `offer-${product.id}`,
    customerId: "test",
    requestedDate: date,
    issuedAt: "2026-11-14T00:00:00Z",
    validUntil: "2026-11-21T00:00:00Z",
    source: "mock",
    closingTime: null,
    logisticModel: "warehouse",
    signature: "test",
    product,
    productId: product.id,
    price: {
      value: price,
      currency: "EUR",
      validFrom: "2026-11-14T00:00:00Z",
      validTo: "2026-11-21T00:00:00Z",
      netPriceFound: true,
    },
    salesBlock: false,
    availability: [
      {
        availableAmount: amount,
        availableDate: date,
        salesUnit: product.salesUnit,
        salesBlock: false,
      },
    ],
  };
}
const line = () => ({
  product: original,
  qty: 3,
  requiredClaims: ["FREE_FROM_LACTOSE"],
});
describe("proactive replacement evidence", () => {
  it("compares whole converted pack totals rather than cheaper unit sticker prices", () => {
    const offers = { source: offer(original, 10), next: offer(next, 2) };
    const result = rankAlternatives(line(), [next], offers, date)[0]!;
    expect(result.qty).toBe(15);
    expect(result.total).toBe(3000);
    expect(result.saving).toBe(0);
    expect(result.reason).toBe("Another pack option");
  });
  it("never promotes unknown, insufficient, later, or wrong-unit stock", () => {
    for (const amount of [0, 14, 999999])
      expect(
        rankAlternatives(
          line(),
          [next],
          { next: offer(next, 1, amount) },
          date,
        ),
      ).toEqual([]);
    const late = offer(next, 1);
    late.availability[0]!.availableDate = "2026-11-21";
    expect(rankAlternatives(line(), [next], { next: late }, date)).toEqual([]);
    const wrong = offer(next, 1);
    wrong.availability[0]!.salesUnit = "BAD";
    expect(rankAlternatives(line(), [next], { next: wrong }, date)).toEqual([]);
  });
  it("requires known compatible conversions and retains dietary declarations", () => {
    expect(
      rankAlternatives(
        line(),
        [{ ...next, claims: [] }],
        { next: offer(next, 1) },
        date,
      ),
    ).toEqual([]);
    expect(
      rankAlternatives(
        line(),
        [{ ...next, pack: { ...next.pack, content: null } }],
        { next: offer(next, 1) },
        date,
      ),
    ).toEqual([]);
    expect(
      rankAlternatives(
        line(),
        [
          {
            ...next,
            pack: { ...next.pack, content: { value: 0.2, unit: "L" } },
          },
        ],
        { next: offer(next, 1) },
        date,
      ),
    ).toEqual([]);
  });
  it("explains unavailability without inventing a saving when the source price is missing", () => {
    const source = offer(original, 5, 0);
    source.price = null;
    const result = rankAlternatives(
      line(),
      [next],
      { source, next: offer(next, 1) },
      date,
    )[0]!;
    expect(result.reason).toBe("Available replacement");
    expect(result.saving).toBeNull();
  });
});
