import { Decimal } from "decimal.js";
import type { Offer } from "@aimo/schema";
import { recipes } from "./recipe-state";
import { purchaseStep } from "./cart";
import { stock, type Line, type StoreProduct } from "./types";
export type ComplementRequest = {
  query: string;
  reason: string;
  source?: string;
};
export type Complement = ComplementRequest & { product: StoreProduct };

// Editorial meal pairings, not claims about other customers' purchases.
const pairings: Record<string, [string, string][]> = {
  pasta: [
    ["tomato sauce", "For the sauce"],
    ["grated cheese", "Finish the dish"],
    ["fresh basil", "Add a fresh finish"],
  ],
  "cooking cream": [
    ["pasta", "For creamy pasta"],
    ["mushroom", "For a mushroom sauce"],
    ["grated cheese", "For a golden topping"],
  ],
  "whipping cream": [
    ["strawberry", "For berry desserts"],
    ["chocolate", "For chocolate desserts"],
  ],
  "coffee cream": [
    ["ground coffee", "For coffee service"],
    ["croissant", "Add a breakfast pastry"],
  ],
  milk: [
    ["ground coffee", "For coffee service"],
    ["oat flakes", "For breakfast porridge"],
  ],
  "plant-based drink": [
    ["ground coffee", "For coffee service"],
    ["oat flakes", "For breakfast porridge"],
  ],
  yogurt: [
    ["granola", "For breakfast bowls"],
    ["blueberry", "Add a berry topping"],
  ],
  butter: [
    ["bread", "For bread service"],
    ["wheat flour", "For baking"],
  ],
};
export function complementRequests(
  product: StoreProduct,
  saved: Line[][],
): ComplementRequest[] {
  const history = new Map<string, number>();
  for (const basket of saved.filter((b) =>
    b.some((l) => l.product.id === product.id),
  )) {
    for (const id of new Set(
      basket
        .filter(
          (l) =>
            l.product.id !== product.id &&
            (product.type === "other" || l.product.type !== product.type),
        )
        .map((l) => l.product.id),
    ))
      history.set(id, (history.get(id) || 0) + 1);
  }
  const familiar = [...history]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([query]) => ({ query, reason: "Together in your saved basket" }));
  const recipe = recipes.find((r) =>
    r.ingredients.some((i) => i.preferredIds.some((id) => id === product.id)),
  );
  const fromRecipe: ComplementRequest[] = recipe
    ? recipe.ingredients
        .filter(
          (i) =>
            !i.water &&
            i.preferredIds.length &&
            !i.preferredIds.some((id) => id === product.id),
        )
        .slice(0, 3)
        .map((i) => ({
          query: i.preferredIds[0]!,
          reason: `For ${recipe.title.toLowerCase()}`,
          source: recipe.source,
        }))
    : [];
  let pairs = pairings[product.type] || [];
  const name = (product.names.en || "").toLowerCase();
  if (!pairs.length && product.group !== "Other") {
    if (/tomato.*sauce|basilico|passata/.test(name))
      pairs = pairings.pasta!.map(([q, r]) => [
        q === "tomato sauce" ? "pasta" : q,
        r,
      ]);
    else if (/\b(tomato|tomatoes|tomberry|cucumber|lettuce)\b/.test(name))
      pairs = [
        ["mozzarella", "For a fresh salad"],
        ["olive oil", "For the dressing"],
        ["fresh basil", "Add a fresh finish"],
      ];
    else if (/\bcoffee\b/.test(name))
      pairs = [
        ["milk", "For coffee service"],
        ["croissant", "Add a breakfast pastry"],
      ];
    else if (/\bcheese\b/.test(name))
      pairs = [
        ["pasta", "For a pasta dish"],
        ["bread", "For sandwiches"],
      ];
    else if (/\bchicken\b/.test(name))
      pairs = [
        ["rice", "For a rice side"],
        ["cooking cream", "For the sauce"],
      ];
    else if (/\bsalmon\b/.test(name))
      pairs = [
        ["potato", "For a potato side"],
        ["lemon", "Finish with lemon"],
      ];
  }
  const seen = new Set<string>();
  return [
    ...familiar,
    ...fromRecipe,
    ...pairs.map(([query, reason]) => ({ query, reason })),
  ]
    .filter((r) => {
      if (seen.has(r.query)) return false;
      seen.add(r.query);
      return true;
    })
    .slice(0, 6);
}
// A suggested add-on starts at a whole sales pack; generic 0.01 lots do not imply 1/100 of a case.
export function complementQuantity(product: StoreProduct) {
  return purchaseStep(
    ["KG", "L"].includes(product.salesUnit)
      ? product
      : { ...product, baseUnit: "ST" },
  );
}
export function eligibleComplements(
  source: StoreProduct,
  candidates: Complement[],
  offers: Record<string, Offer>,
  cart: Line[],
  claims: string[],
  date: string,
) {
  const excluded = new Set([source.id, ...cart.map((l) => l.product.id)]);
  const covered = new Set(
    candidates
      .filter((c) => cart.some((l) => l.product.id === c.product.id))
      .map((c) => c.query),
  );
  return candidates
    .filter(({ product: p, query }) => {
      if (
        excluded.has(p.id) ||
        covered.has(query) ||
        (source.type !== "other" && p.type === source.type) ||
        !claims.every((c) => p.claims.includes(c))
      )
        return false;
      const offer = offers[p.id];
      if (
        !offer?.price ||
        stock(offer, date).status !== "available" ||
        (offer.availability[0]?.availableAmount ?? 0) < complementQuantity(p)
      )
        return false;
      excluded.add(p.id);
      covered.add(query);
      return true;
    })
    .slice(0, 3);
}
export function addComplement(
  cart: Line[],
  product: StoreProduct,
  claims: string[],
): Line[] {
  const existing = cart.find((l) => l.product.id === product.id);
  const requiredClaims = [
    ...new Set([...(existing?.requiredClaims || []), ...claims]),
  ];
  if (!requiredClaims.every((c) => product.claims.includes(c)))
    throw new Error("This product does not meet your dietary requirements.");
  if (!existing && cart.length >= 100)
    throw new Error("A basket supports up to 100 product lines.");
  const qty = new Decimal(existing?.qty || 0)
    .plus(complementQuantity(product))
    .toNumber();
  if (qty > 100000) throw new Error("Choose a smaller quantity.");
  const line = { product, qty, requiredClaims };
  return existing
    ? cart.map((l) => (l.product.id === product.id ? line : l))
    : [...cart, line];
}
