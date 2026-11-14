import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, delivery, now } from "./helpers.js";
import { chooseOffer } from "../apps/buyer-agent/src/planner.js";
import type { Offer } from "@aimo/schema";
let ctx: Awaited<ReturnType<typeof setup>>;
let offers: Offer[];
beforeAll(async () => {
  ctx = await setup();
  offers = (
    await ctx.service.getOffers(ctx.agent, {
      productIds: ["476824", "476812", "461885", "461868"],
      requestedDate: delivery,
    })
  ).offers;
});
afterAll(async () => {
  await ctx.service.db.close();
});
describe("reference buyer candidate selection", () => {
  it("replaces blocked yoghurt only with a positively declared lactose-free candidate", () => {
    const selected = chooseOffer(
      {
        productId: "476824",
        qty: 200,
        unit: "KG",
        requiredClaim: "FREE_FROM_LACTOSE",
      },
      offers.filter((o) => o.product.category === "10412"),
      delivery,
      now,
    );
    expect(selected?.line).toMatchObject({
      productId: "476812",
      substituteFor: "476824",
      qty: 200,
      salesUnit: "ST",
      requiredClaims: ["FREE_FROM_LACTOSE"],
    });
  });
  it("cannot treat a missing claim or unknown stock as a safe substitute", () => {
    const yoghurt = offers.find((o) => o.productId === "476812")!;
    const missing = { ...yoghurt, product: { ...yoghurt.product, claims: [] } };
    const unknown = {
      ...yoghurt,
      availability: yoghurt.availability.map((a) => ({
        ...a,
        availableAmount: 999999,
      })),
    };
    const need = {
      productId: "476824",
      qty: 200,
      unit: "KG" as const,
      requiredClaim: "FREE_FROM_LACTOSE",
    };
    expect(
      chooseOffer(need, [missing, unknown], delivery, now),
    ).toBeUndefined();
  });
  it("skips insufficient stock without silently reducing the requirement", () => {
    const result = chooseOffer(
      { productId: "461885", qty: 150, unit: "KG", requiredClaim: "" },
      offers.filter((o) => o.product.category === "18701"),
      delivery,
      now,
    );
    expect(result?.line).toMatchObject({
      productId: "461868",
      qty: 150,
      salesUnit: "KG",
    });
  });
});
