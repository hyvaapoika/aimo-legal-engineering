import type { Offer } from "@aimo/schema";
import { cents, replacement } from "./cart";
import { stock, type Line, type StoreProduct } from "./types";

// Suggestions may explain an advantage; they never mutate the basket or approve an order.
export function rankAlternatives(
  line: Line,
  products: StoreProduct[],
  offers: Record<string, Offer>,
  date: string,
) {
  const original = offers[line.product.id];
  return products
    .flatMap((product) => {
      const conversion = replacement(line, product);
      const offer = offers[product.id];
      if (
        !conversion ||
        stock(offer, date).status !== "available" ||
        !offer?.price ||
        (offer.availability[0]?.availableAmount ?? 0) < conversion.qty
      )
        return [];
      // Preserve supplier declarations as well as the chef's explicit requirements.
      if (
        !line.product.claims
          .filter(
            (c) =>
              c.startsWith("FREE_FROM_") || ["VEGAN", "VEGETARIAN"].includes(c),
          )
          .every((c) => product.claims.includes(c)) ||
        !line.product.allergenFree.every(
          (c) =>
            product.allergenFree.includes(c) && !product.allergens.includes(c),
        )
      )
        return [];
      const total = cents(conversion.qty, offer.price.value);
      const saving = original?.price
        ? cents(line.qty, original.price.value) - total
        : null;
      const unavailable =
        stock(original, date).status === "blocked" ||
        (stock(original, date).status === "available" &&
          (original?.availability[0]?.availableAmount ?? 0) < line.qty);
      return [
        {
          product,
          ...conversion,
          total,
          saving,
          unavailable,
          reason: unavailable
            ? "Available replacement"
            : saving !== null && saving >= 100
              ? "Lower total"
              : "Another pack option",
        },
      ];
    })
    .sort(
      (a, b) =>
        (b.saving ?? -Infinity) - (a.saving ?? -Infinity) ||
        a.product.id.localeCompare(b.product.id),
    );
}
