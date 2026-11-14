import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { evaluate, type EvaluationContext } from "@aimo/rules";
import { defaultMandate } from "../apps/gateway/src/service.js";
import { testCatalog, now, delivery, input } from "./helpers.js";
import type { Agent, Offer, Order } from "@aimo/schema";
import { MockValioClient } from "@aimo/valio-client";
let base: EvaluationContext;
beforeAll(async () => {
  const catalog = await testCatalog();
  const product = catalog.get("464201");
  const agent: Agent = {
    id: "buyer",
    customerId: "customer",
    name: "Buyer",
    active: true,
    scopes: ["proposals:write"],
    tokenHash: "",
    publicKey: {},
    createdAt: now.toISOString(),
    mandate: defaultMandate(["10400"], now),
  };
  const response = await new MockValioClient({
    "464201": { unitPrice: 1.18 },
  }).lookup(agent.customerId, [product], delivery, now);
  const offer: Offer = {
    id: "offer",
    customerId: agent.customerId,
    productId: product.id,
    product,
    requestedDate: delivery,
    issuedAt: now.toISOString(),
    validUntil: "2026-11-14T10:30:00Z",
    source: "mock",
    price: {
      value: 1.18,
      currency: "EUR",
      validFrom: "2026-11-14T00:00:00Z",
      validTo: "2026-11-17T00:00:00Z",
      netPriceFound: true,
    },
    availability: response.availability.products[0]!.scheduleLines,
    closingTime: "2026-11-14T11:00:00Z",
    salesBlock: false,
    logisticModel: "Stock",
    signature: "fixture",
  };
  base = {
    proposalId: "p1",
    input: input(offer),
    agent,
    offers: new Map([[offer.id, offer]]),
    validSignatures: new Set([offer.id]),
    history: [],
    products: catalog.byId,
    now,
  };
});
function context() {
  return structuredClone(base);
}
function offer(ctx: EvaluationContext) {
  return ctx.offers.get("offer")!;
}
function history(qty = 100, cents = 10000): Order {
  return {
    id: randomUUID(),
    customerId: "customer",
    agentId: "buyer",
    proposalId: "previous",
    verdictId: "v",
    lines: [
      {
        ...base.input.lines[0]!,
        qty,
        name: "Milk",
        unitPrice: 1,
        lineTotalCents: cents,
        deliveryDate: delivery,
      },
    ],
    totalCents: cents,
    currency: "EUR",
    deliveryDate: delivery,
    deliverySite: "haven-kitchen",
    confirmedAt: "2026-11-13T10:00:00Z",
    simulated: true,
  };
}
describe("deterministic rule table", () => {
  it("returns AUTO for a feasible in-mandate request", () =>
    expect(evaluate(context()).result).toBe("AUTO"));
  const cases: [string, string, (c: EvaluationContext) => void][] = [
    [
      "AUTH_AGENT_ACTIVE",
      "REFUSE",
      (c) => {
        c.agent.active = false;
      },
    ],
    [
      "AUTH_AGENT_ACTIVE",
      "REFUSE",
      (c) => {
        c.agent.mandate.validTo = "2026-11-13T10:00:00Z";
      },
    ],
    [
      "AUTH_SCOPE",
      "REFUSE",
      (c) => {
        c.agent.scopes = [];
      },
    ],
    [
      "AUTH_CUSTOMER_MATCH",
      "REFUSE",
      (c) => {
        offer(c).customerId = "other";
      },
    ],
    [
      "FEAS_OFFER_VALID",
      "REFUSE",
      (c) => {
        c.validSignatures.clear();
      },
    ],
    [
      "FEAS_OFFER_VALID",
      "REFUSE",
      (c) => {
        offer(c).validUntil = now.toISOString();
      },
    ],
    [
      "FEAS_PRICED",
      "REFUSE",
      (c) => {
        offer(c).price = null;
      },
    ],
    [
      "FEAS_PRICED",
      "REFUSE",
      (c) => {
        offer(c).price!.netPriceFound = false;
        c.agent.mandate.acceptCatalogPrice = false;
      },
    ],
    [
      "FEAS_NOT_BLOCKED",
      "REFUSE",
      (c) => {
        offer(c).salesBlock = true;
      },
    ],
    [
      "FEAS_NOT_BLOCKED",
      "REFUSE",
      (c) => {
        offer(c).availability[0]!.salesBlock = true;
      },
    ],
    [
      "FEAS_CUTOFF",
      "REFUSE",
      (c) => {
        offer(c).closingTime = now.toISOString();
      },
    ],
    [
      "FEAS_QTY_KNOWN",
      "HOLD",
      (c) => {
        offer(c).availability[0]!.availableAmount = 999999;
      },
    ],
    [
      "FEAS_LOT",
      "REFUSE",
      (c) => {
        offer(c).product.allowedLotSize = 3;
      },
    ],
    [
      "FEAS_AVAILABLE",
      "HOLD",
      (c) => {
        offer(c).availability[0]!.availableAmount = 10;
      },
    ],
    [
      "FEAS_AVAILABLE",
      "HOLD",
      (c) => {
        offer(c).availability = [];
      },
    ],
    [
      "FEAS_DELIVERY",
      "HOLD",
      (c) => {
        offer(c).availability[0]!.availableDate = "2026-11-17";
      },
    ],
    [
      "FEAS_UNIT",
      "REFUSE",
      (c) => {
        c.input.lines[0]!.salesUnit = "KG";
      },
    ],
    [
      "FEAS_PRICE_DATE",
      "REFUSE",
      (c) => {
        c.input.requestedDate = "2026-11-17";
      },
    ],
    [
      "FEAS_WHOLE_UNIT",
      "REFUSE",
      (c) => {
        c.input.lines[0]!.qty = 0.5;
      },
    ],
    [
      "FEAS_DUPLICATE",
      "REFUSE",
      (c) => {
        c.input.lines.push({ ...c.input.lines[0]! });
      },
    ],
    [
      "POL_PER_ORDER",
      "HOLD",
      (c) => {
        c.agent.mandate.limits.perOrder = 10;
      },
    ],
    [
      "POL_PER_WEEK",
      "HOLD",
      (c) => {
        c.agent.mandate.limits.perWeek = 150;
        c.history = [history()];
      },
    ],
    [
      "POL_CATEGORY",
      "HOLD",
      (c) => {
        c.agent.mandate.categories = [];
      },
    ],
    [
      "POL_SITE",
      "HOLD",
      (c) => {
        c.input.deliverySite = "other";
      },
    ],
    [
      "POL_SUBSTITUTION",
      "HOLD",
      (c) => {
        c.input.lines[0]!.substituteFor = "469363";
        c.agent.mandate.substitutionPolicy = "none";
      },
    ],
    [
      "POL_ALLERGEN",
      "REFUSE",
      (c) => {
        c.agent.mandate.allergenFree = ["AM"];
      },
    ],
    [
      "POL_ALLERGEN",
      "REFUSE",
      (c) => {
        c.input.lines[0]!.requiredClaims = ["FREE_FROM_GLUTEN"];
      },
    ],
    [
      "ANOM_LINE_QTY",
      "HOLD",
      (c) => {
        c.history = [history(10)];
      },
    ],
    [
      "ANOM_ORDER_TOTAL",
      "HOLD",
      (c) => {
        c.history = [history(100, 100), history(100, 200), history(100, 300)];
      },
    ],
    [
      "ANOM_NEW_PRODUCT",
      "HOLD",
      (c) => {
        c.input.lines[0]!.qty = 1000;
      },
    ],
  ];
  it.each(cases)("%s produces %s", (id, severity, mutate) => {
    const ctx = context();
    mutate(ctx);
    const verdict = evaluate(ctx);
    expect(verdict.firedRules).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, severity })]),
    );
    expect(verdict.result).toBe(severity);
  });
  it("ignores spend older than the rolling seven-day window", () => {
    const ctx = context();
    ctx.agent.mandate.limits.perWeek = 150;
    ctx.history = [{ ...history(), confirmedAt: "2026-11-01T10:00:00Z" }];
    expect(evaluate(ctx).firedRules.some((r) => r.id === "POL_PER_WEEK")).toBe(
      false,
    );
  });
  it("global limits cannot be bypassed by per-line splitting", () => {
    const ctx = context();
    ctx.agent.mandate.limits.perOrder = 10;
    expect(evaluate(ctx).perLine.every((l) => l.result === "HOLD")).toBe(true);
  });
});
