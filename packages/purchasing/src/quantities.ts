import { Decimal } from "decimal.js";
import type { Offer, Product } from "@aimo/schema";
import type { PlanCandidate, ShopProduct } from "./contracts";
export function step(p: Product) {
  const lot = new Decimal(p.allowedLotSize);
  if (!lot.isPositive()) throw new Error("Invalid supplier lot");
  if (["KG", "L"].includes(p.salesUnit)) return lot.toNumber();
  const scale = 10 ** lot.decimalPlaces(),
    n = lot.mul(scale).toNumber();
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  return n / gcd(n, scale);
}
export function packs(amount: number | null, unit: string, p: ShopProduct) {
  if (amount === null) return null;
  const content = p.pack.content;
  if (
    unit !== "sales" &&
    (!content || content.unit !== unit || content.value <= 0)
  )
    return null;
  return new Decimal(amount)
    .div(unit === "sales" ? 1 : content!.value)
    .div(step(p))
    .ceil()
    .mul(step(p))
    .toNumber();
}
export function offerIssue(
  offer: Offer | undefined,
  qty: number | null,
  date: string,
) {
  if (!offer) return "Offer unavailable";
  if (offer.salesBlock || offer.availability.some((a) => a.salesBlock))
    return "Unavailable";
  if (!offer.price) return "Price unconfirmed";
  if (qty === null) return "Choose a pack quantity; conversion is unconfirmed";
  if (
    !Number.isFinite(qty) ||
    qty <= 0 ||
    !new Decimal(qty).mod(step(offer.product)).isZero()
  )
    return "Choose a legal sales-pack quantity";
  const a = offer.availability[0];
  if (
    !a ||
    a.availableAmount === 999999 ||
    offer.logisticModel?.toLowerCase() === "terminal"
  )
    return "Stock unconfirmed";
  if (a.availableAmount < qty) return "Not enough stock";
  if (!a.availableDate || a.salesUnit !== offer.product.salesUnit)
    return "Delivery unconfirmed";
  if (a.availableDate.slice(0, 10) > date)
    return "Available after the requested date";
  return null;
}
export function candidate(
  p: ShopProduct,
  amount: number | null,
  unit: string,
  offer: Offer | undefined,
  date: string,
  reason: string,
  manual: number | null = null,
): PlanCandidate {
  const qty = manual ?? packs(amount, unit, p),
    issue = offerIssue(offer, qty, date);
  return {
    product: p,
    qty,
    totalCents:
      qty !== null && offer?.price
        ? new Decimal(qty)
            .mul(offer.price.value)
            .mul(100)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
            .toNumber()
        : null,
    available: !issue,
    issue,
    reason,
  };
}
