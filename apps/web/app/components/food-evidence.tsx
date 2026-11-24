import type { Proposal } from "@aimo/schema";

const outcomes = {
  supported: "Supplier declaration meets the kitchen requirement",
  unknown: "Evidence missing",
  contradicted: "Egg warning conflicts with the kitchen requirement",
};

export function FoodEvidence({ proposal }: { proposal: Proposal }) {
  const evidence = proposal.verdict.foodEvidence;
  if (!evidence) return null;
  return (
    <details>
      <summary>Supplier evidence for the kitchen’s egg policy</summary>
      <p>
        Mandate version {evidence.mandateVersion}. Each ordered product needs an
        affirmative supplier declaration.
      </p>
      <ul>
        {evidence.lines.map((line, index) => (
          <li key={line.productId + ":" + index}>
            {line.productId} · {outcomes[line.outcome]}
            {line.declaration && (
              <>
                {" "}
                · {line.declaration.documentId}, revision{" "}
                {line.declaration.revision}, {line.declaration.locator}
              </>
            )}
          </li>
        ))}
      </ul>
      <a href={evidence.informationLaw}>
        EU food information duties, Articles 8 and 9 and Annex II
      </a>
    </details>
  );
}
