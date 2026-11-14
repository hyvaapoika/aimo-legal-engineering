import {
  compatibleReplacement,
  makeLunch,
  productById,
  products,
  replaceProduct,
  totalCents,
  type KitchenDraft,
} from "./state";

export type KitchenProposal = {
  title: string;
  base: KitchenDraft;
  next: KitchenDraft;
  kind: "portions" | "savings";
};

export function proposePortions(
  draft: KitchenDraft,
  portions: number,
): KitchenProposal {
  return {
    title: `Lunch for ${portions} people`,
    base: structuredClone(draft),
    next: makeLunch(portions, draft),
    kind: "portions",
  };
}

// Sample catalogue prices only. Suitability is constrained by explicit declarations.
// The result is advisory: the caller must show the differences before applying it.
export function proposeSavings(draft: KitchenDraft): KitchenProposal {
  let next = structuredClone(draft);
  for (const line of draft.lines) {
    const old = productById(line.productId)!;
    const candidates = products.filter(
      (p) =>
        compatibleReplacement(old, p) &&
        !next.lines.some((l) => l.productId === p.id),
    );
    let best = next;
    for (const candidate of candidates) {
      const option = replaceProduct(next, old.id, candidate.id);
      if (totalCents(option) < totalCents(best)) best = option;
    }
    next = best;
  }
  return {
    title: "A little less on the bill",
    base: structuredClone(draft),
    next,
    kind: "savings",
  };
}

export function applyProposal(
  current: KitchenDraft,
  proposal: KitchenProposal,
): KitchenDraft {
  // Editing the basket makes a previously displayed price/quantity comparison stale.
  if (JSON.stringify(current) !== JSON.stringify(proposal.base))
    throw new Error(
      "Your basket changed. Create a fresh suggestion before applying it.",
    );
  return structuredClone(proposal.next);
}
