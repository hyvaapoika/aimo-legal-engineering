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

// Small, feasible replenishment for the interactive human approval demo.
// Catalog products are supplied data; prices and stock are explicitly synthetic.
export async function runPurchaseDemo(
  service: GatewayService,
  idempotencyKey: string,
) {
  const agent = await service.agent(DEMO_AGENT);
  const prior = (await service.snapshot()).proposals.find(
    (p) => p.agentId === agent.id && p.idempotencyKey === idempotencyKey,
  );
  if (prior) return { proposal: prior };
  const requestedDate = new Date(service.now().getTime() + 2 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const requirements = [
    { id: "464201", qty: 24, unit: "L" as const },
    { id: "475797", qty: 2, unit: "KG" as const },
    { id: "476812", qty: 6, unit: "KG" as const },
    { id: "460428", qty: 3, unit: "KG" as const },
  ];
  const { offers } = await service.getOffers(agent, {
    productIds: requirements.map((r) => r.id),
    requestedDate,
  });
  const proposal = await service.submit(agent, {
    requestedDate,
    deliverySite: "haven-kitchen",
    idempotencyKey,
    lines: requirements.map((r) => {
      const offer = offers.find((o) => o.productId === r.id)!;
      return {
        productId: r.id,
        qty: convertRequirement(offer.product, r.qty, r.unit).qty,
        salesUnit: offer.product.salesUnit,
        offerId: offer.id,
        requiredClaims: [],
        allergenFree: [],
      };
    }),
  });
  return { proposal };
}
