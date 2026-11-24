import { randomUUID } from "node:crypto";
import type {
  Agent,
  FiredRule,
  Offer,
  Order,
  ProposalInput,
  Verdict,
  Product,
  EggEvidenceLine,
  SupplierDeclaration,
} from "@aimo/schema";
import { eggEvidenceRule, foodInformationLaw } from "@aimo/schema";
import { checkEggDeclaration } from "./egg-evidence.js";
import { feasibleRules, lineCents } from "@aimo/feasibility";

export type EvaluationContext = {
  proposalId: string;
  input: ProposalInput;
  agent: Agent;
  offers: Map<string, Offer>;
  validSignatures: Set<string>;
  history: Order[];
  products: Map<string, Product>;
  now: Date;
  requireHumanApproval?: boolean;
  supplierDeclarations?: ReadonlyMap<string, SupplierDeclaration>;
};
export function evaluate(ctx: EvaluationContext): Verdict {
  const { input, agent, now, history } = ctx;
  const m = agent.mandate;
  const rules: FiredRule[] = [];
  const evidenceLines: EggEvidenceLine[] = [];
  const add = (
    id: string,
    severity: "HOLD" | "REFUSE",
    code: string,
    message: string,
    observed?: unknown,
    limit?: unknown,
    productId?: string,
  ) => rules.push({ id, severity, code, message, observed, limit, productId });
  if (!agent.active || Date.parse(m.validTo) <= now.getTime())
    add(
      "AUTH_AGENT_ACTIVE",
      "REFUSE",
      "OUT_OF_MANDATE",
      "Agent or mandate is inactive.",
    );
  if (!agent.scopes.includes("proposals:write"))
    add(
      "AUTH_SCOPE",
      "REFUSE",
      "MISSING_SCOPE",
      "Agent lacks proposal permission.",
    );
  const duplicate = input.lines.some(
    (line, index) =>
      input.lines.findIndex((l) => l.productId === line.productId) !== index,
  );
  if (duplicate)
    add(
      "FEAS_DUPLICATE",
      "REFUSE",
      "DUPLICATE_PRODUCT",
      "Combine repeated products into one line so stock checks cover the full quantity.",
    );
  if (ctx.requireHumanApproval)
    add(
      "POL_HUMAN_APPROVAL",
      "HOLD",
      "HUMAN_APPROVAL_REQUIRED",
      "Every quotation in this demo requires explicit human approval.",
    );
  let totalCents = 0;
  for (const line of input.lines) {
    const offer = ctx.offers.get(line.offerId);
    if (
      !offer ||
      offer.productId !== line.productId ||
      offer.customerId !== agent.customerId
    ) {
      add(
        "AUTH_CUSTOMER_MATCH",
        "REFUSE",
        "OFFER_MISMATCH",
        "Offer must belong to this customer and product.",
        undefined,
        undefined,
        line.productId,
      );
      continue;
    }
    const p = offer.product;
    if (m.requireEggDeclaration) {
      const evidence = checkEggDeclaration(
        p,
        ctx.supplierDeclarations?.get(p.id),
        ctx.products.get(p.id),
      );
      evidenceLines.push(evidence);
      if (evidence.outcome !== "supported")
        add(
          eggEvidenceRule,
          "REFUSE",
          evidence.outcome === "unknown"
            ? "EGG_EVIDENCE_MISSING"
            : "EGG_EVIDENCE_CONFLICT",
          evidence.outcome === "unknown"
            ? "The kitchen requires an explicit supplier declaration covering egg for this product."
            : "The supplier or catalogue flags egg. This product fails the kitchen’s purchasing rule.",
          evidence,
          "affirmative product-specific egg declaration",
          p.id,
        );
    }
    if (
      !ctx.validSignatures.has(offer.id) ||
      Date.parse(offer.validUntil) <= now.getTime()
    )
      add(
        "FEAS_OFFER_VALID",
        "REFUSE",
        "OFFER_EXPIRED",
        "Offer signature is invalid or its validity window has expired.",
        offer.validUntil,
        now.toISOString(),
        p.id,
      );
    if (offer.requestedDate !== input.requestedDate)
      add(
        "FEAS_PRICE_DATE",
        "REFUSE",
        "DATE_MISMATCH",
        "Request fresh offers for the proposed delivery date.",
        offer.requestedDate,
        input.requestedDate,
        p.id,
      );
    if (!offer.price || (!offer.price.netPriceFound && !m.acceptCatalogPrice))
      add(
        "FEAS_PRICED",
        "REFUSE",
        "UNPRICED",
        "No price acceptable under this mandate exists.",
        undefined,
        undefined,
        p.id,
      );
    if (offer.price) totalCents += lineCents(line.qty, offer.price.value);
    rules.push(...feasibleRules(line, offer, input.requestedDate, now));
    if (!m.categories.includes(p.category))
      add(
        "POL_CATEGORY",
        "HOLD",
        "OUT_OF_MANDATE",
        "Product category is outside the mandate.",
        p.category,
        m.categories,
        p.id,
      );
    const claims = [...m.requiredClaims, ...line.requiredClaims];
    const allergens = [...m.allergenFree, ...line.allergenFree];
    if (
      claims.some((c) => !p.claims.includes(c)) ||
      allergens.some(
        (a) => !p.allergenFree.includes(a) || p.allergens.includes(a),
      )
    )
      add(
        "POL_ALLERGEN",
        "REFUSE",
        "ALLERGEN_RULE",
        "Required positive claim or free-from declaration is missing or contradicted.",
        { claims: p.claims, allergenFree: p.allergenFree },
        { claims, allergens },
        p.id,
      );
    if (line.substituteFor) {
      const original = ctx.products.get(line.substituteFor);
      const permitted =
        m.substitutionPolicy === "explicit"
          ? original?.substitutions.includes(p.id)
          : m.substitutionPolicy === "category" &&
            original?.category === p.category;
      if (!permitted)
        add(
          "POL_SUBSTITUTION",
          "HOLD",
          "SUBSTITUTION_REVIEW",
          "This substitution needs a human decision.",
          line.substituteFor,
          m.substitutionPolicy,
          p.id,
        );
      if (
        original &&
        m.allergenProfile === "strict" &&
        (original.claims
          .filter((c) => c.startsWith("FREE_FROM_"))
          .some((c) => !p.claims.includes(c)) ||
          original.allergenFree.some((a) => !p.allergenFree.includes(a)))
      )
        add(
          "POL_ALLERGEN",
          "REFUSE",
          "ALLERGEN_RULE",
          "Strict substitution must preserve every positive free-from declaration.",
          undefined,
          undefined,
          p.id,
        );
    }
    const prior = history
      .flatMap((o) => o.lines)
      .filter((l) => l.productId === p.id);
    const average = prior.length
      ? prior.reduce((sum, l) => sum + l.qty, 0) / prior.length
      : undefined;
    if (average && line.qty > average * 5)
      add(
        "ANOM_LINE_QTY",
        "HOLD",
        "UNUSUAL_QUANTITY",
        "Quantity exceeds five times the historical average.",
        line.qty,
        average * 5,
        p.id,
      );
    if (
      !prior.length &&
      offer.price &&
      lineCents(line.qty, offer.price.value) > 50000
    )
      add(
        "ANOM_NEW_PRODUCT",
        "HOLD",
        "NEW_PRODUCT",
        "First purchase of this product exceeds €500.",
        lineCents(line.qty, offer.price.value) / 100,
        500,
        p.id,
      );
  }
  if (totalCents > Math.round(m.limits.perOrder * 100))
    add(
      "POL_PER_ORDER",
      "HOLD",
      "ORDER_LIMIT",
      `Order total €${(totalCents / 100).toFixed(2)} exceeds the €${m.limits.perOrder.toFixed(2)} per-order mandate.`,
      totalCents / 100,
      m.limits.perOrder,
    );
  const weekCents = history
    .filter((o) => Date.parse(o.confirmedAt) >= now.getTime() - 7 * 86_400_000)
    .reduce((sum, o) => sum + o.totalCents, 0);
  if (weekCents + totalCents > Math.round(m.limits.perWeek * 100))
    add(
      "POL_PER_WEEK",
      "HOLD",
      "WEEK_LIMIT",
      "This order would exceed the rolling seven-day spending mandate.",
      (weekCents + totalCents) / 100,
      m.limits.perWeek,
    );
  if (!m.deliverySites.includes(input.deliverySite))
    add(
      "POL_SITE",
      "HOLD",
      "SITE_REVIEW",
      "Delivery site is outside the mandate.",
      input.deliverySite,
      m.deliverySites,
    );
  const totals = [...history]
    .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt))
    .slice(0, 10)
    .map((o) => o.totalCents)
    .sort((a, b) => a - b);
  if (totals.length >= 3) {
    const middle = Math.floor(totals.length / 2);
    const median =
      totals.length % 2
        ? totals[middle]!
        : (totals[middle - 1]! + totals[middle]!) / 2;
    if (totalCents > median * 3)
      add(
        "ANOM_ORDER_TOTAL",
        "HOLD",
        "UNUSUAL_TOTAL",
        "Order is more than three times the recent median.",
        totalCents / 100,
        (median * 3) / 100,
      );
  }
  const result = rules.some((r) => r.severity === "REFUSE")
    ? "REFUSE"
    : rules.length
      ? "HOLD"
      : "AUTO";
  return {
    id: randomUUID(),
    proposalId: ctx.proposalId,
    result,
    firedRules: rules,
    ...(m.requireEggDeclaration
      ? {
          foodEvidence: {
            ruleId: eggEvidenceRule,
            origin: "kitchen_policy",
            informationLaw: foodInformationLaw,
            mandateVersion: m.version,
            lines: evidenceLines,
          },
        }
      : {}),
    perLine: input.lines.map((line) => {
      const applicable = rules.filter(
        (r) => !r.productId || r.productId === line.productId,
      );
      return {
        productId: line.productId,
        result: applicable.some((r) => r.severity === "REFUSE")
          ? "REFUSE"
          : applicable.length
            ? "HOLD"
            : "AUTO",
      };
    }),
    evaluatedAt: now.toISOString(),
  };
}
