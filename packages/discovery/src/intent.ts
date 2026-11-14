import { normalize } from "./model";
import type { Intent } from "./ai";
const synonyms: Record<string, string> = {
  kerma: "cream",
  ruokakerma: "cooking cream",
  kuohukerma: "whipping cream",
  maito: "milk",
  voi: "butter",
  juusto: "cheese",
  jogurtti: "yogurt",
  peruna: "potato",
  kananmuna: "egg",
  jauho: "flour",
  kana: "chicken",
  lohi: "salmon",
  jogurt: "yogurt",
  yoghurt: "yogurt",
  tomaatit: "tomatoes",
  tomaatti: "tomato",
  penne: "penne",
  laktoositon: "lactose free",
  gluteeniton: "gluten free",
  vegaaninen: "vegan",
};
export function basicIntent(query: string): Intent {
  let q = normalize(query);
  const claims: Intent["claims"] = [];
  const unresolved: string[] = [];
  if (
    /\b(not|without|no)\s+(lactose free|gluten free|vegan|organic|vegetarian)|\b(non vegan)\b/.test(
      q,
    )
  )
    unresolved.push("Negative dietary preference needs review.");
  if (
    /\b(nut free|peanut free|dairy free|milk free|allergy|allergies|allergen|allergens|pahkinaton|maidoton)\b/.test(
      q,
    )
  )
    unresolved.push(
      "This allergen restriction needs explicit supplier evidence.",
    );
  if (
    /\b(without|except|exclude|excluding|avoid|avoiding|no|not|less|under|below|tomorrow|today|budget|sugar free|low fat|halal|kosher)\b/.test(
      q,
    ) ||
    /[€$]/.test(query)
  )
    unresolved.push(
      "This extra requirement cannot be applied automatically. Edit your search or use the product details to check it.",
    );
  for (const [rx, claim] of [
    [/\b(lactose free|lactosefree|laktoositon)\b/, "FREE_FROM_LACTOSE"],
    [/\b(gluten free|glutenfree|gluteeniton)\b/, "FREE_FROM_GLUTEN"],
    [/\b(vegan|vegaaninen)\b/, "VEGAN"],
    [/\b(organic|luomu)\b/, "ORGANIC"],
    [/\bvegetarian\b/, "VEGETARIAN"],
  ] as const)
    if (rx.test(q)) {
      if (!unresolved.some((x) => x.startsWith("Negative"))) claims.push(claim);
      q = q.replace(rx, " ");
    }
  if (/\bfree\b/.test(q))
    unresolved.push(
      "This free-from requirement is not supported by an explicit catalogue filter.",
    );
  const preferredPack =
    query
      .toLowerCase()
      .match(
        /\b\d+(?:[.,]\d+)?\s*(?:kg|litres?|liters?|litre|liter|l|g|ml)\b/,
      )?.[0] ?? null;
  q = q.replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|litres?|liters?|l|g|ml)\b/g, " ");
  q = q.replace(
    /\b(i|we|m|am|re|would|like|looking|can|could|you|get|need|want|please|find|show|me|us|some|for|around|about|a|an|the|of|products?|by|tomorrow)\b/g,
    " ",
  );
  const terms = q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => synonyms[t] || t);
  return { terms, claims, preferredPack, unresolved };
}
