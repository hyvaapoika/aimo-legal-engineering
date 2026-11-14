import type { Product } from "@aimo/schema";
import { z } from "zod";

export const groups = [
  "All products",
  "Dairy & eggs",
  "Meat & fish",
  "Fruit & vegetables",
  "Bakery",
  "Pantry",
  "Drinks",
  "Other",
] as const;
export const claimLabels: Record<string, string> = {
  FREE_FROM_LACTOSE: "Lactose-free",
  FREE_FROM_GLUTEN: "Gluten-free",
  VEGAN: "Vegan",
  ORGANIC: "Organic",
  VEGETARIAN: "Vegetarian",
};
export const searchInput = z
  .object({
    query: z.string().max(300).default(""),
    group: z.enum(groups).default("All products"),
    category: z.string().max(40).optional(),
    brand: z.string().max(100).optional(),
    claims: z
      .array(
        z.enum([
          "FREE_FROM_LACTOSE",
          "FREE_FROM_GLUTEN",
          "VEGAN",
          "ORGANIC",
          "VEGETARIAN",
        ]),
      )
      .max(5)
      .default([]),
    page: z.number().int().min(1).max(1000).default(1),
    limit: z.number().int().min(1).max(48).default(24),
    smart: z.boolean().default(false),
  })
  .strict();
export type SearchRequest = z.infer<typeof searchInput>;
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const name = (p: Product) => p.names.en || p.names.fi || p.id;
// Presentation groups are our conservative, name-based navigation, not supplier taxonomy.
export function productType(p: Product): string {
  const n = normalize(name(p));
  if (
    /\b(cleaner|cleanser|cleaning|detergent|soap|equipment|machine|candy|toffee|ice cream|potatoes|soup|sauce|chocolate|dessert|wafer|biscuit|spray|siphon)\b/.test(
      n,
    )
  )
    return "other";
  if (
    /\b(cooking cream|food cream)\b/.test(n) ||
    /ruokakerma/.test(normalize(p.names.fi || ""))
  )
    return "cooking cream";
  if (/\b(whipping cream|double cream)\b/.test(n)) return "whipping cream";
  if (/\b(coffee cream)\b/.test(n)) return "coffee cream";
  if (
    /\b(oat|soy|almond|coconut|cashew)\b/.test(n) &&
    /\b(milk|drink|cream)\b/.test(n)
  )
    return "plant-based drink";
  if (
    /\bmilk\b/.test(n) &&
    !/\b(coffee|espresso|powder|shake|milkshake|chocolate|condensed|evaporated)\b/.test(
      n,
    )
  )
    return "milk";
  if (/\bbutter\b/.test(n) && !/\b(peanut|cocoa|shea)\b/.test(n))
    return "butter";
  if (/\b(yogurt|yoghurt)\b/.test(n)) return "yogurt";
  if (
    /\b(penne|macaroni|spaghetti|fusilli|pasta)\b/.test(n) &&
    !/\b(salad|filled|meal)\b/.test(n)
  )
    return "pasta";
  return "other";
}
export function groupFor(p: Product): (typeof groups)[number] {
  const n = normalize(name(p));
  if (
    /\b(cleaner|cleanser|cleaning|detergent|soap|equipment|machine)\b/.test(n)
  )
    return "Other";
  if (
    /\b(cream|milk|cheese|butter|yogurt|yoghurt|egg|quark)\b/.test(n) &&
    !/\b(ice cream|candy|toffee|chocolate|cake|biscuit|sauce|potatoes|soup|powder)\b/.test(
      n,
    )
  )
    return "Dairy & eggs";
  if (
    /\b(salmon|fish|tuna|herring|cod|chicken|beef|pork|turkey|sausage|bacon|ham|meat|shrimp|prawn)\b/.test(
      n,
    )
  )
    return "Meat & fish";
  if (
    /\b(apple|banana|potato|potatoes|carrot|tomato|tomatoes|onion|broccoli|lettuce|cucumber|basil|spinach|berries|strawberry|vegetables)\b/.test(
      n,
    ) &&
    !/\b(soup|sauce|candy|juice|drink|jam|yogurt)\b/.test(n)
  )
    return "Fruit & vegetables";
  if (/\b(bread|bun|roll|croissant|cake|pastry|dough|biscuit)\b/.test(n))
    return "Bakery";
  if (/\b(juice|water|coffee|tea|beer|wine|lemonade|drink)\b/.test(n))
    return "Drinks";
  if (
    /\b(pasta|penne|macaroni|spaghetti|rice|flour|oil|salt|sugar|pepper|sauce|spice|nuts|peanuts|beans|lentil|canned)\b/.test(
      n,
    )
  )
    return "Pantry";
  return "Other";
}
const photos: Record<string, string> = {
  "464249": "cream.png",
  "465174": "cheese.png",
  "475797": "butter.png",
  "475437": "pasta.jpg",
  "465046": "tomatoes.png",
};
export function imageFor(p: Product) {
  return photos[p.id] ? `/kitchen/${photos[p.id]}` : null;
}
export function hasClaim(p: Product, claim: string) {
  return p.claims.includes(claim);
}
export function documentFor(p: Product) {
  return `${name(p)}\n${p.names.fi || ""}\nBrand: ${p.brand}\nType: ${productType(p)}\n${Object.values(
    p.details?.descriptions || {},
  )
    .slice(0, 2)
    .join(" ")
    .slice(0, 700)}\n${Object.values(p.details?.usage || {})
    .join(" ")
    .slice(0, 250)}\n${Object.values(p.details?.preparation || {})
    .join(" ")
    .slice(0, 250)}`.slice(0, 1800);
}
export function packLabel(p: Product) {
  const f =
    p.salesUnit === p.baseUnit
      ? 1
      : p.packs.find((x) => x.unitId === p.salesUnit)?.sizeInBaseUnits;
  return {
    unit: p.salesUnit,
    factor: f ?? null,
    content:
      p.netContent && !p.netContent.inferred && f
        ? {
            value: Number((p.netContent.value * f).toFixed(4)),
            unit: p.netContent.unit,
          }
        : null,
  };
}
export function present(p: Product, reasons: string[] = []) {
  return {
    ...p,
    group: groupFor(p),
    type: productType(p),
    image: imageFor(p),
    pack: packLabel(p),
    reasons,
  };
}
export type StoreProduct = ReturnType<typeof present>;
