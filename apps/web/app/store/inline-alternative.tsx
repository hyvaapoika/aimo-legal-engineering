"use client";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Offer } from "@aimo/schema";
import {
  api,
  money,
  productName,
  stock,
  unitLabel,
  type Line,
  type StoreProduct,
} from "./types";
import { rankAlternatives } from "./proactive";
import { ProductMedia } from "./media";

type Props = {
  line: Line;
  date: string;
  currentOffer?: Offer;
  disabled?: boolean;
  always?: boolean;
  samplePrices?: boolean;
  action?: string;
  accept?: (product: StoreProduct, qty: number) => boolean;
  onSelect: (product: StoreProduct, qty: number) => void;
};
export function InlineAlternative({
  line,
  date,
  currentOffer,
  disabled,
  always = false,
  samplePrices = true,
  action = "Swap",
  onSelect,
  accept,
}: Props) {
  const [data, setData] = useState<{
    productId: string;
    date: string;
    products: StoreProduct[];
    offers: Record<string, Offer>;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setFailed(false);
    if (!date) return () => controller.abort();
    api<{ products: StoreProduct[] }>(
      "alternatives",
      { id: line.product.id },
      controller.signal,
    )
      .then(async ({ products }) => {
        const result = products.length
          ? await api<{ offers: Offer[] }>(
              "offers",
              {
                productIds: products.map((p) => p.id),
                requestedDate: date,
                includeSubstitutesFor: [],
              },
              controller.signal,
            )
          : { offers: [] };
        if (!controller.signal.aborted)
          setData({
            productId: line.product.id,
            date,
            products,
            offers: Object.fromEntries(
              result.offers.map((o) => [o.productId, o]),
            ),
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [line.product.id, date]);
  const unavailable = stock(currentOffer, date).status === "blocked";
  if (!data || data.productId !== line.product.id || data.date !== date)
    return unavailable || always ? (
      <p className="r-alt-status">
        {failed
          ? "Replacement suggestions could not load."
          : "Checking suitable replacements…"}
      </p>
    ) : null;
  const offers = {
    ...data.offers,
    ...(currentOffer ? { [line.product.id]: currentOffer } : {}),
  };
  const candidate = rankAlternatives(line, data.products, offers, date).find(
    (c) =>
      (!accept || accept(c.product, c.qty)) &&
      (always || c.unavailable || (c.saving ?? 0) >= 100),
  );
  if (!candidate)
    return unavailable ? (
      <p className="r-alt-status">
        No replacement with confirmed stock and pack conversion.
      </p>
    ) : null;
  return (
    <section
      className="r-inline-alt"
      aria-label={`Suggested alternative for ${productName(line.product)}`}
    >
      <ProductMedia product={candidate.product} />
      <div className="r-alt-copy">
        <span className="r-alt-reason">
          {candidate.reason}
          {candidate.saving !== null && candidate.saving >= 100
            ? ` · save ${money(candidate.saving / 100)}`
            : ""}
        </span>
        <strong>{productName(candidate.product)}</strong>
        <span>
          {candidate.qty} {unitLabel(candidate.product.salesUnit)} ·{" "}
          {money(candidate.total / 100)}
          {samplePrices ? " · sample price" : ""}
        </span>
        <small>
          {candidate.excess > 0
            ? `${Number(candidate.excess.toFixed(3))} ${candidate.unit} extra · `
            : ""}
          {candidate.product.reasons[0] || "Check recipe suitability"}
        </small>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(candidate.product, candidate.qty)}
        aria-label={`${action} to ${productName(candidate.product)}`}
      >
        {action} <ArrowRight size={14} />
      </button>
    </section>
  );
}
