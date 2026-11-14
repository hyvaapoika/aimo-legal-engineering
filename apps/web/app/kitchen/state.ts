import source from "./products.json";

export type KitchenProduct = Omit<
  (typeof source)[number],
  "claims" | "allergens" | "allergenFree"
> & {
  claims: string[];
  allergens: string[];
  allergenFree: string[];
};
export const products: KitchenProduct[] = source;
export const productById = (id: string) => products.find((p) => p.id === id);
export function compatibleReplacement(
  old: KitchenProduct,
  next: KitchenProduct,
) {
  const dietaryClaims = [
    "FREE_FROM_GLUTEN",
    "FREE_FROM_LACTOSE",
    "VEGAN",
    "VEGETARIAN",
  ];
  return (
    old.id !== next.id &&
    old.kind === next.kind &&
    old.measure === next.measure &&
    !next.unavailable &&
    old.claims
      .filter((c) => dietaryClaims.includes(c))
      .every((c) => next.claims.includes(c)) &&
    old.allergenFree.every((c) => next.allergenFree.includes(c))
  );
}
export type DraftLine = { productId: string; qty: number };
export type KitchenDraft = { portions: number; lines: DraftLine[] };
// Explicitly illustrative recipe coefficients. They are not a verified kitchen recipe.
export const recipe = [
  { kind: "pasta", productId: "475437", amount: 80 },
  { kind: "tomatoes", productId: "465046", amount: 120 },
  { kind: "cream", productId: "464249", amount: 30 },
  { kind: "cheese", productId: "465174", amount: 20 },
  { kind: "butter", productId: "475797", amount: 5 },
  { kind: "basil", productId: "460362", amount: 1 },
];
export const euros = (cents: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
export function packCount(amount: number, packAmount: number) {
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isFinite(packAmount) ||
    packAmount <= 0
  )
    throw new Error("A known positive pack conversion is required.");
  return Math.ceil(amount / packAmount);
}
export function makeLunch(
  portions: number,
  previous?: KitchenDraft,
): KitchenDraft {
  if (!Number.isInteger(portions) || portions < 1 || portions > 1000)
    throw new Error("Choose between 1 and 1,000 portions.");
  if (previous) {
    const scaled = new Set<string>();
    return {
      portions,
      lines: previous.lines.map((line) => {
        const p = productById(line.productId)!;
        const r = recipe.find((item) => item.kind === p.kind);
        if (!r || scaled.has(p.kind)) return line;
        scaled.add(p.kind);
        return { ...line, qty: packCount(portions * r.amount, p.packAmount) };
      }),
    };
  }
  return {
    portions,
    lines: recipe.map((r) => {
      const p = productById(r.productId)!;
      return {
        productId: p.id,
        qty: packCount(portions * r.amount, p.packAmount),
      };
    }),
  };
}
export function replacementQuantity(
  draft: KitchenDraft,
  oldId: string,
  newId: string,
) {
  const old = productById(oldId)!,
    next = productById(newId)!;
  const line = draft.lines.find((l) => l.productId === oldId)!;
  const coefficient = recipe.find((r) => r.kind === old.kind);
  const recipeAmount = coefficient
    ? coefficient.amount * draft.portions
    : undefined;
  const amount =
    recipeAmount !== undefined &&
    line.qty === packCount(recipeAmount, old.packAmount)
      ? recipeAmount
      : old.packAmount * line.qty;
  return packCount(amount, next.packAmount);
}
export function replaceProduct(
  draft: KitchenDraft,
  oldId: string,
  newId: string,
): KitchenDraft {
  const old = productById(oldId),
    next = productById(newId);
  const line = draft.lines.find((l) => l.productId === oldId);
  if (!old || !next || !line || !compatibleReplacement(old, next))
    throw new Error(
      "Choose an available product with compatible units and declared dietary properties.",
    );
  // Preserve manual quantity overrides; otherwise avoid multiplying rounded excess.
  const qty = replacementQuantity(draft, oldId, newId);
  const already = draft.lines.find((l) => l.productId === newId)?.qty ?? 0;
  return {
    ...draft,
    lines: draft.lines
      .filter((l) => l.productId !== newId)
      .map((l) =>
        l.productId === oldId ? { productId: newId, qty: qty + already } : l,
      ),
  };
}
export function setQuantity(
  draft: KitchenDraft,
  productId: string,
  qty: number,
): KitchenDraft {
  if (
    !productById(productId) ||
    !Number.isInteger(qty) ||
    qty < 0 ||
    qty > 10000
  )
    throw new Error("Use a whole number of packs between 0 and 10,000.");
  const lines = qty
    ? draft.lines.map((l) =>
        l.productId === productId ? { productId, qty } : l,
      )
    : draft.lines.filter((l) => l.productId !== productId);
  if (qty && !lines.some((l) => l.productId === productId))
    lines.push({ productId, qty });
  return { ...draft, lines };
}
export function totalCents(draft: KitchenDraft) {
  return draft.lines.reduce(
    (sum, line) => sum + productById(line.productId)!.priceCents * line.qty,
    0,
  );
}
export function restoreDraft(value: unknown): KitchenDraft | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as KitchenDraft;
  if (
    !Number.isInteger(v.portions) ||
    v.portions < 1 ||
    v.portions > 1000 ||
    !Array.isArray(v.lines) ||
    v.lines.length > products.length
  )
    return;
  const ids = new Set<string>();
  for (const line of v.lines) {
    if (
      !line ||
      !productById(line.productId) ||
      ids.has(line.productId) ||
      !Number.isInteger(line.qty) ||
      line.qty < 1 ||
      line.qty > 10000
    )
      return;
    ids.add(line.productId);
  }
  return {
    portions: v.portions,
    lines: v.lines.map(({ productId, qty }) => ({ productId, qty })),
  };
}
