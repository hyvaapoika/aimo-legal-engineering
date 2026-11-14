"use client";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { Offer } from "@aimo/schema";
import {
  api,
  money,
  packText,
  productName,
  unitLabel,
  type Line,
  type StoreProduct,
  type SearchResult,
} from "./types";
import { cents } from "./cart";
import {
  complementRequests,
  complementQuantity,
  eligibleComplements,
  type Complement,
} from "./complements";
import { ProductMedia } from "./media";

type Props = {
  product: StoreProduct;
  cart: Line[];
  saved: Line[][];
  claims: string[];
  date: string;
  samplePrices: boolean;
  disabled: boolean;
  onAdd: (product: StoreProduct, claims: string[]) => void;
};
export function ProductComplements({
  product,
  cart,
  saved,
  claims,
  date,
  samplePrices,
  disabled,
  onAdd,
}: Props) {
  const claimKey = [...new Set(claims)].sort().join(",");
  const historyKey = JSON.stringify(
    saved.map((b) => b.map((l) => l.product.id)),
  );
  const key = `${product.id}:${date}:${claimKey}:${historyKey}`;
  const [data, setData] = useState<{
    key: string;
    candidates: Complement[];
    offers: Record<string, Offer>;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const requests = complementRequests(product, saved);
    if (!requests.length || !date) {
      setData(null);
      return () => controller.abort();
    }
    void (async () => {
      const responses = await Promise.allSettled(
        requests.map(async (request) => {
          const result = await api<SearchResult>(
            "suggest",
            {
              query: request.query,
              claims: claimKey ? claimKey.split(",") : [],
              limit: 4,
            },
            controller.signal,
          );
          return result.products.map((p) => ({ ...request, product: p }));
        }),
      );
      const groups = responses.flatMap((r) =>
        r.status === "fulfilled" ? [r.value] : [],
      );
      // Interleave so three recommendations cover different meal components.
      const candidates = Array.from({ length: 4 }, (_, i) =>
        groups.flatMap((g) => (g[i] ? [g[i]!] : [])),
      ).flat();
      const ids = [...new Set(candidates.map((c) => c.product.id))];
      const result = ids.length
        ? await api<{ offers: Offer[] }>(
            "offers",
            { productIds: ids, requestedDate: date, includeSubstitutesFor: [] },
            controller.signal,
          )
        : { offers: [] };
      if (!controller.signal.aborted)
        setData({
          key,
          candidates,
          offers: Object.fromEntries(
            result.offers.map((o) => [o.productId, o]),
          ),
        });
    })().catch(() => {
      if (!controller.signal.aborted) setData(null);
    });
    return () => controller.abort();
  }, [key]);
  if (!data || data.key !== key) return null;
  const recommendations = eligibleComplements(
    product,
    data.candidates,
    data.offers,
    cart,
    claims,
    date,
  );
  if (!recommendations.length) return null;
  return (
    <section className="r-complements" aria-label="Goes well with this">
      <div className="r-complements-heading">
        <h3>Goes well with this</h3>
        <span>Complete the dish</span>
      </div>
      <div className="r-complement-list">
        {recommendations.map(({ product: p, reason, source }) => (
          <article key={p.id}>
            <ProductMedia product={p} />
            <div className="r-complement-copy">
              <small>
                {source ? (
                  <a href={source} target="_blank" rel="noreferrer">
                    {reason}
                  </a>
                ) : (
                  reason
                )}
              </small>
              <strong>{productName(p)}</strong>
              <span>{packText(p)}</span>
              <b>
                {money(
                  cents(
                    complementQuantity(p),
                    data.offers[p.id]!.price!.value,
                  ) / 100,
                )}{" "}
                <span>
                  for {complementQuantity(p)} {unitLabel(p.salesUnit)}
                </span>
              </b>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAdd(p, claims)}
              aria-label={`Add recommended ${productName(p)}`}
            >
              <Plus size={15} /> Add
            </button>
          </article>
        ))}
      </div>
      {samplePrices && (
        <p className="r-complement-note">Sample prices · excl. VAT</p>
      )}
    </section>
  );
}
