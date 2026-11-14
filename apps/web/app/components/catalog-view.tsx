"use client";
import { useState, useCallback, useEffect } from "react";
import { Search } from "lucide-react";
import type { Product } from "@aimo/schema";
import { api, count } from "./shared";
import { PageHeading, Empty } from "./primitives";
export function CatalogView({ count: total }: { count: number }) {
  const [query, setQuery] = useState("lactose-free milk");
  const [results, setResults] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const search = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ products: Product[] }>(
        `catalog/search?query=${encodeURIComponent(query)}`,
      );
      setResults(data.products);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query]);
  useEffect(() => {
    void search();
  }, []);
  return (
    <>
      <PageHeading
        eyebrow={`${count(total)} SUPPLIED PRODUCTS`}
        title="Start with the right product."
        description="Search locally. Request dynamic prices only after narrowing the shortlist."
      />
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Search size={19} />
        <input
          aria-label="Search products"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Product name or code"
        />
        <button className="primary" disabled={loading}>
          Search catalog
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product / supplier code</th>
              <th>Sales unit</th>
              <th>Pack / lot</th>
              <th>Reliability</th>
              <th>kg CO₂e / kg</th>
            </tr>
          </thead>
          <tbody>
            {results.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.names.fi || p.names.en || p.id}</strong>
                  <small className="mono">
                    {p.id} <span className="separator">/</span> {p.category}
                  </small>
                  {p.claims.includes("FREE_FROM_LACTOSE") && (
                    <span className="claim">Lactose-free</span>
                  )}
                </td>
                <td className="mono">
                  {p.salesUnit}
                  <small>
                    {p.netContent
                      ? `${p.netContent.value} ${p.netContent.unit}${p.netContent.inferred ? " (inferred)" : ""}`
                      : "Content unknown"}
                  </small>
                </td>
                <td className="mono">
                  {p.packs.find((x) => x.unitId === "KI")?.sizeInBaseUnits ??
                    "—"}{" "}
                  / {p.allowedLotSize}
                </td>
                <td className="mono">
                  {p.reliability === undefined
                    ? "Unknown"
                    : `${(p.reliability * 100).toFixed(1)}%`}
                </td>
                <td className="mono">
                  {p.carbonKgPerKg?.toFixed(2) ?? "Unknown"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!results.length && !loading && (
        <Empty>No matching products. Try a name in Finnish or English.</Empty>
      )}
      <p className="small muted">
        Historical reliability is a ranking signal, not a delivery guarantee.
        Missing comparison data stays unknown.
      </p>
    </>
  );
}
