import { convertRequirement, feasibleRules } from "@aimo/feasibility";
import type { Offer, ProposalLine } from "@aimo/schema";

export type InventoryNeed = {
  productId: string;
  qty: number;
  unit: "L" | "KG" | "PCS";
  requiredClaim: string;
};
export function chooseOffer(
  need: InventoryNeed,
  candidates: Offer[],
  requestedDate: string,
  now = new Date(),
): { offer: Offer; line: ProposalLine } | undefined {
  for (const offer of candidates) {
    if (
      !offer.price ||
      Date.parse(offer.validUntil) <= now.getTime() ||
      (need.requiredClaim && !offer.product.claims.includes(need.requiredClaim))
    )
      continue;
    try {
      const converted = convertRequirement(offer.product, need.qty, need.unit);
      const line: ProposalLine = {
        productId: offer.productId,
        qty: converted.qty,
        salesUnit: converted.salesUnit,
        offerId: offer.id,
        requiredClaims: need.requiredClaim ? [need.requiredClaim] : [],
        allergenFree: [],
        ...(offer.productId !== need.productId
          ? {
              substituteFor: need.productId,
              rationale:
                "Code-filtered same-category alternative with sufficient stock and matching declared requirements.",
            }
          : {}),
      };
      if (feasibleRules(line, offer, requestedDate, now).length === 0)
        return { offer, line };
    } catch {
      /* Missing conversions exclude the candidate; they never justify a guess. */
    }
  }
  return undefined;
}
