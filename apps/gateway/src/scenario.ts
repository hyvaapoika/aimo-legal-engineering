import { randomUUID } from "node:crypto";
import { convertRequirement } from "@aimo/feasibility";
import type { Offer, ProposalLine } from "@aimo/schema";
import { GatewayService, DEMO_AGENT } from "./service.js";
export async function runDemoScenario(service: GatewayService) {
  const agent = await service.agent(DEMO_AGENT);
  const requestedDate = new Date(service.now().getTime() + 2 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const batch = await service.getOffers(agent, {
    productIds: [
      "464201",
      "476824",
      "476812",
      "475797",
      "461885",
      "461868",
      "460000",
    ],
    requestedDate,
    includeSubstitutesFor: ["476824", "461885"],
  });
  const byProduct = new Map(batch.offers.map((o) => [o.productId, o]));
  const line = (
    id: string,
    qty: number,
    unit: "L" | "KG",
    substituteFor?: string,
  ): ProposalLine => {
    const offer = byProduct.get(id) as Offer;
    return {
      productId: id,
      qty: convertRequirement(offer.product, qty, unit).qty,
      salesUnit: offer.product.salesUnit,
      offerId: offer.id,
      substituteFor,
      requiredClaims:
        id === "464201" || id === "476812" ? ["FREE_FROM_LACTOSE"] : [],
      allergenFree: [],
    };
  };
  const submit = (lines: ProposalLine[]) =>
    service.submit(agent, {
      requestedDate,
      deliverySite: "haven-kitchen",
      lines,
      idempotencyKey: randomUUID(),
    });
  const auto = await submit([
    line("464201", 100, "L"),
    line("475797", 10, "KG"),
  ]);
  const held = await submit([
    line("464201", 1000, "L"),
    line("476812", 200, "KG", "476824"),
    line("475797", 60, "KG"),
    line("461868", 150, "KG", "461885"),
  ]);
  const short = await submit([line("461885", 150, "KG")]);
  const blocked = await submit([line("476824", 200, "KG")]);
  return {
    auto,
    held,
    short,
    blocked,
    substitutions: batch.substitutions,
    offers: batch.offers,
    note: "Prices and availability are synthetic scenario fixtures; products and comparison signals are supplied challenge data.",
  };
}
