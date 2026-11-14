import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  recipes,
  recipeMatches,
  portionsFrom,
  ingredientAmount,
  ingredientQuantity,
  pantryMentions,
} from "../apps/web/app/store/recipe-state";
import { Discovery, present, basicIntent } from "@aimo/discovery";
import { testCatalog } from "./helpers";
let d: Discovery;
let catalog: Awaited<ReturnType<typeof testCatalog>>;
beforeAll(async () => {
  catalog = await testCatalog();
  d = new Discovery(catalog);
});
afterAll(async () => {
  await d.close();
});
describe("Immediate suggestions and recipe planning", () => {
  it("returns product suggestions synchronously without a provider or vector dependency", () => {
    const result = d.suggest({ query: "we need milk" });
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.mode).toBe("instant");
    expect(result.total).toBeGreaterThan(0);
  });
  it("preserves mandatory declarations in the immediate path", () => {
    const r = d.suggest({ query: "lactose-free milk" });
    expect(r.products.length).toBeGreaterThan(0);
    expect(
      r.products.every((p) => p.claims.includes("FREE_FROM_LACTOSE")),
    ).toBe(true);
    expect(d.suggest({ query: "milk without peanuts" }).total).toBe(0);
    expect(d.suggest({ query: "0000000000000000000" }).total).toBe(0);
  });
  it("suggests sourced recipes before a sentence is finished", () => {
    expect(recipeMatches("I’m making pas").length).toBe(3);
    expect(recipeMatches("I’m making chicken pasta").map((r) => r.id)).toEqual([
      "chicken-pasta",
    ]);
  });
  it("never presents a non-vegan or unverified gluten-free recipe as a valid dietary match", () => {
    expect(recipeMatches("vegan pasta")).toEqual([]);
    expect(recipeMatches("gluten-free pasta")).toEqual([]);
    expect(recipeMatches("pasta without chicken")).toEqual([]);
    expect(
      recipeMatches("vegetarian pasta").every((r) =>
        r.tags.includes("vegetarian"),
      ),
    ).toBe(true);
  });
  it("scales source quantities using published yields and preserves unspecified seasoning amounts", () => {
    const r = recipes[0]!;
    expect(r.basePortions).toBe(10);
    expect(ingredientAmount(r.ingredients[0]!, r, 80)).toBe(6.4);
    expect(ingredientAmount(r.ingredients[0]!, r, 120)).toBe(9.6);
    expect(ingredientAmount(r.ingredients[3]!, r, 80)).toBeNull();
    expect(() => ingredientAmount(r.ingredients[0]!, r, 0)).toThrow();
  });
  it("never assumes density or inferred pack contents during a recipe conversion", () => {
    const p = present(catalog.get("466360"));
    expect(ingredientQuantity(6.4, p)).toBe(26);
    expect(ingredientQuantity(null, p)).toBeNull();
    expect(
      ingredientQuantity(1, {
        ...p,
        pack: { ...p.pack, content: { value: 1, unit: "L" } },
      }),
    ).toBeNull();
    expect(
      ingredientQuantity(1, { ...p, pack: { ...p.pack, content: null } }),
    ).toBeNull();
  });
  it("accepts explicit pantry statements without converting negation into stock", () => {
    const r = recipes[0]!;
    expect(pantryMentions("I already have pasta and carrots", r)).toEqual([
      "tomato-pasta-0",
      "tomato-pasta-1",
    ]);
    expect(pantryMentions("I don't have pasta", r)).toEqual([]);
    expect(pantryMentions("I don’t have pasta", r)).toEqual([]);
    expect(pantryMentions("I have no carrots", r)).toEqual([]);
    expect(pantryMentions("I might need carrots", r)).toEqual([]);
  });
  it("parses bounded portion counts and keeps free-from intent explicit", () => {
    expect(portionsFrom("Make it for 120 people")).toBe(120);
    expect(portionsFrom("80 portions")).toBe(80);
    expect(portionsFrom("for 4000 people")).toBeNull();
    expect(basicIntent("lactose-free pasta").claims).toEqual([
      "FREE_FROM_LACTOSE",
    ]);
  });
});
