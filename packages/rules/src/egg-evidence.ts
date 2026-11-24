import type {
  EggEvidenceLine,
  Product,
  SupplierDeclaration,
} from "@aimo/schema";

/** Kitchen purchasing policy KITCHEN-EGG-01/v1. See docs/food-evidence.md. */
export function checkEggDeclaration(
  product: Product,
  declaration: SupplierDeclaration | undefined,
  currentProduct?: Product,
): EggEvidenceLine {
  const statement = declaration?.productId === product.id ? declaration : null;
  const catalogueFlagsEgg =
    product.allergens.includes("AE") ||
    currentProduct?.allergens.includes("AE") === true;
  let outcome: EggEvidenceLine["outcome"] = "unknown";
  if (
    catalogueFlagsEgg ||
    statement?.egg === "contains" ||
    statement?.egg === "may_contain"
  )
    outcome = "contradicted";
  else if (statement?.egg === "declared_free") outcome = "supported";
  return {
    productId: product.id,
    declaration: statement,
    catalogueFlagsEgg,
    outcome,
  };
}
