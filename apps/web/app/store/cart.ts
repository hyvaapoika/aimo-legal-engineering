import { Decimal } from "decimal.js";
import { productSchema, type Product } from "@aimo/schema";
import type { Line, StoreProduct } from "./types";

// Whole sales packs for packaged goods; supplier lot increments for weighed goods.
export function purchaseStep(p: Product) {
  const lot = new Decimal(p.allowedLotSize);
  if (!lot.isPositive()) throw new Error("Invalid supplier lot");
  if (p.baseUnit !== "ST") return lot.toNumber();
  const scale = 10 ** lot.decimalPlaces();
  const numerator = lot.mul(scale).toNumber();
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  return numerator / gcd(numerator, scale);
}
export function replacement(old: Line, next: StoreProduct) {
  if (old.allowedReplacementIds && !old.allowedReplacementIds.includes(next.id))
    return null;
  if (!(old.requiredClaims || []).every((c) => next.claims.includes(c)))
    return null;
  const a = old.product.pack.content,
    b = next.pack.content;
  if (!a || !b || a.unit !== b.unit || a.value <= 0 || b.value <= 0)
    return null;
  const needed = new Decimal(old.qty).mul(a.value);
  const step = purchaseStep(next);
  const qty = needed.div(b.value).div(step).ceil().mul(step);
  return {
    qty: qty.toNumber(),
    excess: qty.mul(b.value).minus(needed).toNumber(),
    unit: b.unit,
  };
}
export function cents(qty: number, price: number) {
  return new Decimal(qty)
    .mul(price)
    .mul(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}
export function restoreLines(value: unknown): Line[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((line: unknown) => {
    if (!line || typeof line !== "object") return [];
    const l = line as Line;
    const parsed = productSchema.safeParse(l.product);
    if (
      !parsed.success ||
      !Number.isFinite(l.qty) ||
      l.qty <= 0 ||
      l.qty > 100000
    )
      return [];
    const p = parsed.data;
    const factor =
      p.salesUnit === p.baseUnit
        ? 1
        : p.packs.find((x) => x.unitId === p.salesUnit)?.sizeInBaseUnits;
    // Rebuild display conversions from validated supplier fields, never cached derived values.
    const product: StoreProduct = {
      ...p,
      group: "",
      type: "",
      image: null,
      reasons: [],
      pack: {
        unit: p.salesUnit,
        factor: factor ?? null,
        content:
          p.netContent && !p.netContent.inferred && factor
            ? { value: p.netContent.value * factor, unit: p.netContent.unit }
            : null,
      },
    };
    return [
      {
        product,
        qty: l.qty,
        ...(Array.isArray(l.allowedReplacementIds)
          ? {
              allowedReplacementIds: l.allowedReplacementIds
                .filter((id): id is string => typeof id === "string")
                .slice(0, 10),
            }
          : {}),
        requiredClaims: Array.isArray(l.requiredClaims)
          ? l.requiredClaims.filter((x): x is string => typeof x === "string")
          : [],
      },
    ];
  });
}

// A merged line must satisfy both original kitchen choices.
export function mergeReplacementIds(a?: string[], b?: string[]) {
  if (!a) return b;
  if (!b) return a;
  return a.filter((id) => b.includes(id));
}
