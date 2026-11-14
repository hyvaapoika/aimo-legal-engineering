import type { Product, Offer } from "@aimo/schema";
export type StoreProduct = Product & {
  group: string;
  type: string;
  image: string | null;
  reasons: string[];
  pack: {
    unit: string;
    factor: number | null;
    content: { value: number; unit: string } | null;
  };
};
export type SearchResult = {
  products: StoreProduct[];
  total: number;
  catalogCount: number;
  page: number;
  pages: number;
  mode: string;
  embeddingCount: number;
  intent: {
    terms: string[];
    claims: string[];
    preferredPack: string | null;
    unresolved: string[];
  };
  filters: { claims: string[]; group: string; brand: string };
  facets: { brands: [string, number][]; groups: [string, number][] };
  refinements: string[];
  unresolved: string[];
};
export type Line = {
  product: StoreProduct;
  qty: number;
  requiredClaims?: string[];
};
export const labels: Record<string, string> = {
  FREE_FROM_LACTOSE: "Lactose-free",
  FREE_FROM_GLUTEN: "Gluten-free",
  VEGAN: "Vegan",
  ORGANIC: "Organic",
  VEGETARIAN: "Vegetarian",
};
export const money = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    n,
  );
export const productName = (p: Product) => p.names.en || p.names.fi || p.id;
export const unitLabel = (unit: string) =>
  ({ ST: "piece", KI: "case", KG: "kg", L: "litre" })[unit] || unit;
export function stock(o?: Offer, date?: string) {
  if (!o) return { label: "Check availability", status: "unknown" };
  if (o.salesBlock || o.availability.some((a) => a.salesBlock))
    return { label: "Unavailable", status: "blocked" };
  const a = o.availability[0];
  if (!a) return { label: "Stock unconfirmed", status: "unknown" };
  if (a.availableAmount === 0)
    return { label: "Unavailable", status: "blocked" };
  if (
    a.availableAmount === 999999 ||
    o.logisticModel?.toLowerCase() === "terminal"
  )
    return { label: "Stock unconfirmed", status: "unknown" };
  if (!a.availableDate || a.salesUnit !== o.product.salesUnit)
    return { label: "Delivery unconfirmed", status: "unknown" };
  if (date && a.availableDate.slice(0, 10) > date)
    return { label: "Later delivery", status: "unknown" };
  return {
    label: `${a.availableAmount} ${unitLabel(a.salesUnit)} available`,
    status: "available",
  };
}
export function packText(p: StoreProduct) {
  return p.pack.content
    ? `${p.pack.content.value} ${p.pack.content.unit === "L" ? "L" : p.pack.content.unit === "KG" ? "kg" : p.pack.content.unit} / ${unitLabel(p.salesUnit)}`
    : `Sold by ${unitLabel(p.salesUnit)}${p.pack.factor && p.pack.factor > 1 ? ` · ${p.pack.factor} base units` : ""}`;
}
export { purchaseStep as minimum } from "./cart";
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch(`/api/shop/${path}`, {
    signal,
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || "Request failed");
  return data;
}
