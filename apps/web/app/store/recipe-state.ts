import { basicIntent } from "../../../../packages/discovery/src/intent";
import { Decimal } from "decimal.js";
import source from "../../../../packages/discovery/src/recipes-data.json";
import { purchaseStep } from "./cart";
import type { StoreProduct } from "./types";
export const recipes = source;
export type Recipe = (typeof recipes)[number];
export type Ingredient = Recipe["ingredients"][number];
export const portionsFrom = (text: string) => {
  const m =
    text.match(/\b(?:for|serve|serves|serving)\s+(\d{1,4})\b/i) ||
    text.match(/\b(\d{1,4})\s*(?:people|portions|servings|guests)\b/i);
  const n = m ? Number(m[1]) : null;
  return n && n <= 1000 ? n : null;
};
export function cookingIntent(text: string) {
  return (
    /\b(pas(?:t(?:a)?)?|recipe|recipes|cooking|making|make|menu|lunch|dinner)\b/i.test(
      text,
    ) && !/^\s*(?:cooking\s+cream)\b/i.test(text)
  );
}
export function recipeMatches(text: string) {
  if (!text.trim()) return recipes;
  if (basicIntent(text).unresolved.length) return [];
  if (/\b(vegan|gluten.free|nut.free|dairy.free|milk.free)\b/i.test(text))
    return [];
  const words = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2);
  const scored = recipes.map((r) => ({
    r,
    score: r.tags.reduce(
      (s, t) =>
        s +
        Number(
          words.some((w) => w === t || (w.length >= 3 && t.startsWith(w))),
        ),
      0,
    ),
  }));
  const specific = words.filter((w) =>
    ["chicken", "tomato", "vegetarian", "creamy", "oven"].includes(w),
  );
  return scored
    .filter(
      (x) =>
        x.score > 0 &&
        specific.every((w) => x.r.tags.includes(w)) &&
        (!/\bvegetarian\b/i.test(text) || x.r.tags.includes("vegetarian")),
    )
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
}
export function ingredientAmount(
  ingredient: Ingredient,
  recipe: Recipe,
  portions: number,
) {
  if (!Number.isInteger(portions) || portions < 1 || portions > 1000)
    throw new Error("Choose 1–1,000 portions");
  return ingredient.amountKg === null
    ? null
    : new Decimal(ingredient.amountKg)
        .mul(portions)
        .div(recipe.basePortions)
        .toDecimalPlaces(6)
        .toNumber();
}
export function ingredientQuantity(amountKg: number | null, p: StoreProduct) {
  const content = p.pack.content;
  if (
    amountKg === null ||
    !content ||
    content.unit !== "KG" ||
    content.value <= 0
  )
    return null;
  return new Decimal(amountKg)
    .div(content.value)
    .div(purchaseStep(p))
    .ceil()
    .mul(purchaseStep(p))
    .toNumber();
}

export function pantryMentions(text: string, recipe: Recipe) {
  if (/\b(?:not|no|without|except|dont|don[’']t)\b/i.test(text)) return [];
  const m = text.match(/\b(?:already have|have|got)\s+(.+)/i);
  if (!m) return [];
  return recipe.ingredients
    .filter((i) =>
      i.name
        .toLowerCase()
        .split(" ")
        .some(
          (w) =>
            w.length > 3 && new RegExp(`\\b${w}(?:s)?\\b`, "i").test(m[1]!),
        ),
    )
    .map((i) => i.id);
}
