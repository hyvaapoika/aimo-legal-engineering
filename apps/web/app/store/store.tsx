"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Search,
  ShoppingCart,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  Plus,
  Minus,
  X,
  SlidersHorizontal,
  Sparkles,
  Check,
  Scale,
  Truck,
  Leaf,
  Package,
  RotateCcw,
  Heart,
  LoaderCircle,
  Info,
  CalendarDays,
} from "lucide-react";
import type { Offer, Proposal } from "@aimo/schema";
import { useDialog } from "../components/use-dialog";
import { ProductMedia } from "./media";
import {
  api,
  labels,
  money,
  productName,
  packText,
  unitLabel,
  minimum,
  stock,
  type StoreProduct,
  type SearchResult,
  type Line,
} from "./types";
import "./store.css";
import { replacement, cents, restoreLines } from "./cart";
import { Decimal } from "decimal.js";
const groups = [
  "All products",
  "Dairy & eggs",
  "Meat & fish",
  "Fruit & vegetables",
  "Bakery",
  "Pantry",
  "Drinks",
  "Other",
];
type Context = {
  customerId: string;
  deliverySites: string[];
  source: string;
  today: string;
};
type View =
  | { kind: "detail"; product: StoreProduct }
  | { kind: "compare" }
  | { kind: "cart" }
  | { kind: "alternatives"; product: StoreProduct }
  | null;
function Drawer({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useDialog(close);
  return (
    <div className="s-overlay" onClick={close}>
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="s-drawer-title"
        className={`s-drawer ${wide ? "wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 id="s-drawer-title">{title}</h2>
          <button className="s-icon" aria-label="Close panel" onClick={close}>
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export default function Store() {
  const [query, setQuery] = useState(""),
    [input, setInput] = useState(""),
    [group, setGroup] = useState("All products"),
    [brand, setBrand] = useState(""),
    [claims, setClaims] = useState<string[]>([]),
    [page, setPage] = useState(1),
    [smart, setSmart] = useState(false),
    [retry, setRetry] = useState(0);
  const [result, setResult] = useState<SearchResult>(),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [context, setContext] = useState<Context>(),
    [date, setDate] = useState(""),
    [dateOpen, setDateOpen] = useState(false);
  const [offers, setOffers] = useState<Record<string, Offer>>({}),
    [pricing, setPricing] = useState(false),
    [priceError, setPriceError] = useState(""),
    [cart, setCart] = useState<Line[]>([]),
    [previous, setPrevious] = useState<Line[]>(),
    [compare, setCompare] = useState<StoreProduct[]>([]),
    [view, setView] = useState<View>(null);
  const [alternatives, setAlternatives] = useState<StoreProduct[]>([]),
    [alternativesBusy, setAlternativesBusy] = useState(false),
    [filterOpen, setFilterOpen] = useState(false),
    [toast, setToast] = useState(""),
    [hydrated, setHydrated] = useState(false),
    [saved, setSaved] = useState<Line[][]>([]),
    [savedOpen, setSavedOpen] = useState(false);
  const [proposal, setProposal] = useState<Proposal>(),
    [submitting, setSubmitting] = useState(false),
    [checkoutError, setCheckoutError] = useState("");
  const serial = useRef(0),
    priceSerial = useRef(0),
    dateRef = useRef(""),
    cartRevision = useRef(0),
    checkoutKey = useRef<string>("");
  const checkoutPayload = useRef<unknown>(null);
  useEffect(() => {
    const restore = () => {
      const p = new URLSearchParams(location.search);
      setQuery(p.get("q") || "");
      setInput(p.get("q") || "");
      setGroup(
        groups.includes(p.get("group") || "")
          ? p.get("group")!
          : "All products",
      );
      setBrand(p.get("brand") || "");
      setClaims((p.get("claims") || "").split(",").filter((c) => labels[c]));
      setPage(Math.max(1, Number(p.get("page")) || 1));
      setSmart(p.get("smart") === "1");
    };
    restore();
    window.addEventListener("popstate", restore);
    api<Context>("context")
      .then((c) => {
        setContext(c);
        const d = new Date(c.today + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() + 2);
        const day = d.toISOString().slice(0, 10);
        setDate(day);
        dateRef.current = day;
      })
      .catch((e) => setError(e.message));
    try {
      const raw = JSON.parse(
        localStorage.getItem("aimo-store-cart-v1") || "[]",
      );
      setCart(restoreLines(raw));
      const lists = JSON.parse(
        localStorage.getItem("aimo-store-saved-v1") || "[]",
      );
      if (Array.isArray(lists))
        setSaved(lists.filter(Array.isArray).slice(0, 8).map(restoreLines));
    } catch {}
    setHydrated(true);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    if (hydrated) {
      try {
        localStorage.setItem("aimo-store-cart-v1", JSON.stringify(cart));
        localStorage.setItem("aimo-store-saved-v1", JSON.stringify(saved));
      } catch {}
    }
  }, [cart, saved, hydrated]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!hydrated) return;
    const current = ++serial.current;
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (group !== "All products") params.set("group", group);
    if (brand) params.set("brand", brand);
    if (claims.length) params.set("claims", claims.join(","));
    if (page > 1) params.set("page", String(page));
    if (smart) params.set("smart", "1");
    const url =
      location.pathname + (params.size ? "?" + params.toString() : "");
    if (url !== location.pathname + location.search)
      history.pushState(null, "", url);
    api<SearchResult>("search", {
      query,
      group,
      brand: brand || undefined,
      claims,
      page,
      limit: 24,
      smart,
    })
      .then((r) => {
        if (serial.current === current) setResult(r);
      })
      .catch((e) => {
        if (serial.current === current) setError(e.message);
      })
      .finally(() => {
        if (serial.current === current) setLoading(false);
      });
  }, [query, group, brand, claims, page, smart, hydrated, retry]);
  const extra =
    view?.kind === "compare"
      ? compare
      : view?.kind === "alternatives"
        ? alternatives
        : view?.kind === "detail"
          ? [view.product]
          : [];
  const priceIds = [
    ...new Set(
      [
        ...(result?.products || []),
        ...extra,
        ...cart.map((l) => l.product),
      ].map((p) => p.id),
    ),
  ]
    .sort()
    .join(",");
  useEffect(() => {
    if (!date || !priceIds) return;
    const current = ++priceSerial.current;
    setPricing(true);
    setPriceError("");
    api<{ offers: Offer[] }>("offers", {
      productIds: priceIds.split(","),
      requestedDate: date,
      includeSubstitutesFor: [],
    })
      .then((r) => {
        if (priceSerial.current === current) {
          setOffers(Object.fromEntries(r.offers.map((o) => [o.productId, o])));
        }
      })
      .catch((e) => {
        if (priceSerial.current === current) {
          setOffers({});
          setPriceError(e.message);
        }
      })
      .finally(() => {
        if (priceSerial.current === current) setPricing(false);
      });
  }, [date, priceIds]);
  const search = (q: string, enhance = true) => {
    setRetry((n) => n + 1);
    setInput(q);
    setQuery(q);
    setSmart(enhance);
    setPage(1);
    setProposal(undefined);
  };
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    search(input, true);
  };
  const filterClaim = (c: string) => {
    setClaims((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
    setPage(1);
  };
  const changeCart = (next: Line[], message: string) => {
    cartRevision.current++;
    checkoutKey.current = "";
    checkoutPayload.current = null;
    setPrevious(cart);
    setCart(next);
    setProposal(undefined);
    setCheckoutError("");
    setToast(message);
  };
  const setQuantity = (p: StoreProduct, n: number) => {
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      setToast("Choose a valid quantity.");
      return;
    }
    n = Number(n.toFixed(6));
    if (n && !new Decimal(n).mod(minimum(p)).isZero()) {
      setToast(
        `Choose quantities in steps of ${minimum(p)} ${unitLabel(p.salesUnit)}.`,
      );
      return;
    }
    const next = cart.filter((l) => l.product.id !== p.id);
    if (n && next.length >= 100) {
      setToast("A basket supports up to 100 product lines.");
      return;
    }
    if (n)
      next.push({
        product: p,
        qty: n,
        requiredClaims: cart.find((l) => l.product.id === p.id)
          ?.requiredClaims ?? [
          ...new Set([...claims, ...(result?.intent.claims || [])]),
        ],
      });
    changeCart(next, n ? "Basket updated." : "Product removed.");
  };
  const add = (p: StoreProduct) => {
    setQuantity(
      p,
      (cart.find((l) => l.product.id === p.id)?.qty || 0) + minimum(p),
    );
  };
  const undo = () => {
    if (previous) {
      cartRevision.current++;
      setCart(previous);
      setPrevious(undefined);
      setProposal(undefined);
      checkoutKey.current = "";
      checkoutPayload.current = null;
      setToast("Last basket change undone.");
    }
  };
  const toggleCompare = (p: StoreProduct) => {
    setCompare((s) =>
      s.some((x) => x.id === p.id)
        ? s.filter((x) => x.id !== p.id)
        : s.length < 3
          ? [...s, p]
          : s,
    );
  };
  const openAlternatives = async (p: StoreProduct) => {
    setView({ kind: "alternatives", product: p });
    setAlternatives([]);
    setAlternativesBusy(true);
    try {
      const r = await api<{ products: StoreProduct[] }>("alternatives", {
        id: p.id,
      });
      setAlternatives(r.products);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setAlternativesBusy(false);
    }
  };
  const replace = (old: StoreProduct, next: StoreProduct) => {
    const line = cart.find((l) => l.product.id === old.id);
    if (!line) {
      add(next);
      return;
    }
    const conversion = replacement(line, next);
    if (!conversion) {
      setToast(
        "This replacement cannot preserve the required claims or convert the packs safely. Choose another product.",
      );
      return;
    }
    const count = conversion.qty;
    const existing = cart.find((l) => l.product.id === next.id)?.qty || 0;
    changeCart(
      [
        ...cart.filter(
          (l) => l.product.id !== old.id && l.product.id !== next.id,
        ),
        {
          product: next,
          qty: count + existing,
          requiredClaims: [
            ...new Set([
              ...(line.requiredClaims || []),
              ...(cart.find((l) => l.product.id === next.id)?.requiredClaims ||
                []),
            ]),
          ],
        },
      ],
      "Replacement added. Review its quantity in your basket.",
    );
    setView({ kind: "cart" });
  };
  const total =
    cart.reduce(
      (n, l) => n + cents(l.qty, offers[l.product.id]?.price?.value || 0),
      0,
    ) / 100;
  const complete = cart.every((l) => offers[l.product.id]?.price);
  const checkout = async () => {
    if (!context || !cart.length || submitting) return;
    setSubmitting(true);
    setCheckoutError("");
    const revision = cartRevision.current;
    try {
      if (checkoutPayload.current) {
        const retried = await api<Proposal>(
          "proposals",
          checkoutPayload.current,
        );
        if (revision === cartRevision.current) setProposal(retried);
        return;
      }
      const refreshed = await api<{ offers: Offer[] }>("offers", {
        productIds: cart.map((l) => l.product.id),
        requestedDate: date,
        includeSubstitutesFor: [],
      });
      if (revision !== cartRevision.current)
        throw new Error(
          "Basket changed. Review it before requesting approval.",
        );
      const map = new Map(refreshed.offers.map((o) => [o.productId, o]));
      if (
        cart.some(
          (l) =>
            map.get(l.product.id)?.price?.value !==
            offers[l.product.id]?.price?.value,
        )
      ) {
        setOffers(
          Object.fromEntries(refreshed.offers.map((o) => [o.productId, o])),
        );
        throw new Error(
          "Prices changed. Review the updated total, then request approval again.",
        );
      }
      checkoutKey.current ||= crypto.randomUUID();
      const payload = {
        requestedDate: date,
        deliverySite: context.deliverySites[0],
        idempotencyKey: checkoutKey.current,
        requirementRef: "Smart webshop cart",
        lines: cart.map((l) => ({
          productId: l.product.id,
          offerId: map.get(l.product.id)!.id,
          qty: l.qty,
          salesUnit: map.get(l.product.id)!.product.salesUnit,
          requiredClaims: l.requiredClaims || [],
        })),
      };
      checkoutPayload.current = payload;
      const result = await api<Proposal>("proposals", payload);
      if (revision === cartRevision.current) setProposal(result);
    } catch (e) {
      setCheckoutError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };
  const card = (p: StoreProduct) => {
    const offer = offers[p.id];
    const availability = stock(offer, date);
    const selected = compare.some((x) => x.id === p.id);
    const quantity = cart.find((l) => l.product.id === p.id)?.qty;
    return (
      <article className="s-card" key={p.id}>
        <div className="s-card-top">
          <span>
            {p.claims.includes("FREE_FROM_LACTOSE")
              ? "LACTOSE-FREE"
              : p.claims.includes("FREE_FROM_GLUTEN")
                ? "GLUTEN-FREE"
                : p.brand || "CATALOGUE"}
          </span>
          <button
            className={`s-icon ${selected ? "chosen" : ""}`}
            aria-label={`Compare ${productName(p)}`}
            aria-pressed={selected}
            disabled={!selected && compare.length === 3}
            onClick={() => toggleCompare(p)}
          >
            <Scale size={19} />
          </button>
        </div>
        <button
          className="s-image-link"
          onClick={() => setView({ kind: "detail", product: p })}
        >
          <ProductMedia product={p} />
        </button>
        <div className="s-card-copy">
          <span className="s-brand">{p.brand || "Supplier product"}</span>
          <button
            className="s-product-name"
            onClick={() => setView({ kind: "detail", product: p })}
          >
            {productName(p)}
          </button>
          <p className="s-pack">{packText(p)}</p>
          {p.reasons[0] && (
            <span className="s-reason">
              <Check size={12} />
              {p.reasons[0].replace("Supplier-declared ", "")}
            </span>
          )}
          <div className="s-price">
            <strong>
              {offer?.price
                ? money(offer.price.value)
                : pricing
                  ? "…"
                  : "Price unconfirmed"}
            </strong>
            <span>/ {unitLabel(p.salesUnit)}</span>
          </div>
          {offer?.price && p.pack.content && (
            <small className="s-unit-price">
              {money(offer.price.value / p.pack.content.value)} /{" "}
              {p.pack.content.unit === "L"
                ? "L"
                : p.pack.content.unit === "KG"
                  ? "kg"
                  : p.pack.content.unit}
            </small>
          )}
          <span className={`s-stock ${availability.status}`}>
            <i />
            {availability.label}
          </span>
          <div className="s-card-actions">
            <button
              className="s-add"
              disabled={availability.status === "blocked"}
              onClick={() => add(p)}
            >
              {quantity ? (
                <>
                  <Check size={16} /> In basket · {quantity}
                  <Plus size={16} />
                </>
              ) : (
                <>
                  Add to basket <Plus size={17} />
                </>
              )}
            </button>
            <button
              className="s-icon"
              aria-label={`Alternatives for ${productName(p)}`}
              onClick={() => openAlternatives(p)}
            >
              <SlidersHorizontal size={18} />
            </button>
          </div>
        </div>
      </article>
    );
  };
  return (
    <div className="store">
      <div className="s-topbar">
        <span>
          <Truck size={14} /> Valio Aimo · Foodservice wholesale
        </span>
        <span>
          Local hackathon webshop <i />{" "}
          {context?.source === "valio" ? "Challenge API" : "Demo"} prices &
          availability
        </span>
        <Link href="/operations">
          Purchasing & approvals <ArrowRight size={13} />
        </Link>
      </div>
      <header className="s-header">
        <a href="/" aria-label="Valio Aimo home">
          <img src="/store/aimo-logo.svg" alt="Valio Aimo" />
        </a>
        <nav aria-label="Main navigation">
          <button
            className="active"
            onClick={() => {
              search("", false);
              setGroup("All products");
              setClaims([]);
              setBrand("");
            }}
          >
            PRODUCTS
          </button>
          <button onClick={() => setSavedOpen(true)}>SAVED BASKETS</button>
          <button onClick={() => setDateOpen(!dateOpen)}>
            DELIVERY <ChevronDown size={13} />
          </button>
        </nav>
        <div className="s-header-actions">
          <button
            className="s-customer"
            onClick={() =>
              setToast(
                "Local demo buyer: Hotel Haven. Approval uses a separate human sign-in.",
              )
            }
          >
            <span>HH</span>
            <div>
              Hotel Haven<small>Demo kitchen</small>
            </div>
          </button>
          <button
            className="s-cart-button"
            onClick={() => setView({ kind: "cart" })}
          >
            <ShoppingCart size={22} />
            <span>Basket</span>
            <b>{cart.length}</b>
          </button>
        </div>
      </header>
      <section className="s-hero">
        <div>
          <span className="s-eyebrow">GOOD FOOD STARTS HERE</span>
          <h1>Everything for your kitchen.</h1>
          <p>
            Your familiar assortment. A smarter way to find the right
            ingredients.
          </p>
        </div>
        <div className="s-search-area">
          <form onSubmit={submitSearch}>
            <Search size={23} />
            <label className="s-sr" htmlFor="store-search">
              Search products
            </label>
            <input
              id="store-search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Try ‘lactose-free cooking cream, 1 litre’"
            />
            <button type="submit" aria-label="Search catalogue">
              <ArrowRight size={23} />
            </button>
          </form>
          <div>
            <span>
              <Sparkles size={13} /> Search by name, product number, or what you
              need
            </span>
            <button onClick={() => search(query, !smart)}>
              {smart ? "Smart search on" : "Basic search"}{" "}
              <ChevronDown size={12} />
            </button>
          </div>
        </div>
      </section>
      <main className="s-main">
        <div className="s-breadcrumb">
          Products <ChevronRight size={12} />{" "}
          {group === "All products" ? "All products" : group}
        </div>
        <div className="s-toolbar">
          <div className="s-group-tabs">
            {groups.slice(0, -1).map((g) => (
              <button
                key={g}
                className={group === g ? "active" : ""}
                onClick={() => {
                  setGroup(g);
                  setPage(1);
                }}
              >
                {g}
              </button>
            ))}
          </div>
          <button
            className="s-filter-toggle"
            onClick={() => setFilterOpen(!filterOpen)}
            aria-expanded={filterOpen}
          >
            <SlidersHorizontal size={17} /> Filters{" "}
            {claims.length + Number(!!brand) > 0 && (
              <b>{claims.length + Number(!!brand)}</b>
            )}
          </button>
        </div>
        <div className={`s-filters ${filterOpen ? "open" : ""}`}>
          <label>
            Brand{" "}
            <select
              aria-label="Filter by brand"
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All brands</option>
              {brand && !result?.facets.brands.some(([b]) => b === brand) && (
                <option>{brand}</option>
              )}
              {result?.facets.brands.map(([b, n]) => (
                <option key={b} value={b}>
                  {b} ({n})
                </option>
              ))}
            </select>
          </label>
          {Object.entries(labels).map(([c, label]) => (
            <button
              key={c}
              className={claims.includes(c) ? "selected" : ""}
              aria-pressed={claims.includes(c)}
              onClick={() => filterClaim(c)}
            >
              {claims.includes(c) && <Check size={13} />} {label}
            </button>
          ))}
          <span className="s-delivery">
            <Truck size={16} />
            <button onClick={() => setDateOpen(!dateOpen)}>
              {date
                ? new Date(date + "T12:00").toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })
                : "Delivery date"}{" "}
              <ChevronDown size={12} />
            </button>
          </span>
        </div>
        {dateOpen && (
          <div className="s-date-panel">
            <CalendarDays size={22} />
            <div>
              <strong>Choose your requested delivery date</strong>
              <p>
                Availability is checked for this date. It is not a delivery
                guarantee.
              </p>
            </div>
            <input
              aria-label="Requested delivery date"
              type="date"
              min={context?.today}
              value={date}
              onChange={(e) => {
                if (!e.target.value) return;
                dateRef.current = e.target.value;
                setDate(e.target.value);
                setOffers({});
                cartRevision.current++;
                checkoutKey.current = "";
                checkoutPayload.current = null;
                setProposal(undefined);
              }}
            />
            <button
              className="s-icon"
              aria-label="Close delivery settings"
              onClick={() => setDateOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {query && (
          <section className="s-smart-strip">
            <Sparkles size={20} />
            <div>
              <strong>
                {loading
                  ? "Finding your products…"
                  : result?.mode === "ai" || result?.mode === "hybrid"
                    ? "Understood your search"
                    : result?.mode === "semantic"
                      ? "Searching by meaning"
                      : "Search results"}{" "}
                <span>“{query}”</span>
              </strong>
              <div className="s-understood">
                {result?.intent.claims.map((c) => (
                  <button
                    key={c}
                    aria-label={`Remove ${labels[c]} requirement`}
                    onClick={() => {
                      setClaims(result.intent.claims.filter((x) => x !== c));
                      search(result.intent.terms.join(" "), false);
                    }}
                  >
                    <Check size={12} />
                    {labels[c]}
                    <X size={12} />
                  </button>
                ))}
                {result?.intent.preferredPack && (
                  <span>
                    <Package size={12} />
                    Pack preference: {result.intent.preferredPack} · check pack
                    sizes
                  </span>
                )}
                {result?.refinements.map((r) => (
                  <button key={r} onClick={() => search(r, true)}>
                    {r}
                    <ArrowRight size={12} />
                  </button>
                ))}
                {!result?.refinements.length &&
                  !result?.intent.claims.length && (
                    <small>
                      Browse real catalogue matches, or refine with the filters.
                    </small>
                  )}
              </div>
            </div>
            <button
              className="s-icon"
              aria-label="Clear search"
              onClick={() => {
                search("", false);
                setClaims([]);
                setBrand("");
              }}
            >
              <X size={18} />
            </button>
          </section>
        )}
        <div className="s-results-heading">
          <div>
            <h2>
              {query
                ? `Products for “${query}”`
                : group === "All products"
                  ? "Explore the assortment"
                  : group}
            </h2>
            <span>
              {loading
                ? "Finding products…"
                : `${(result?.total || 0).toLocaleString()} products`}{" "}
              <i /> {(result?.catalogCount || 17546).toLocaleString()} in the
              catalogue
            </span>
          </div>
          <div>
            {loading && <LoaderCircle size={17} className="spin" />}
            <span>
              {loading
                ? ""
                : smart && result?.mode === "basic"
                  ? "Basic search · AI unavailable"
                  : smart
                    ? "Relevance"
                    : "Catalogue order"}
            </span>
          </div>
        </div>
        {error && (
          <div className="s-error" role="alert">
            {error}
            <button onClick={() => setRetry((n) => n + 1)}>Retry search</button>
          </div>
        )}
        {priceError && (
          <div className="s-error" role="alert">
            Prices and stock could not be confirmed. {priceError}
          </div>
        )}
        {(result?.unresolved.length || 0) > 0 && (
          <div className="s-caution">
            <Info size={22} />
            <div>
              <strong>One requirement needs a closer look</strong>
              {result?.unresolved.map((u) => (
                <p key={u}>{u}</p>
              ))}
              <p>
                We haven’t relaxed your requirement. Edit your search to
                continue.
              </p>
            </div>
          </div>
        )}
        <div
          className={`s-products ${loading ? "loading" : ""}`}
          aria-busy={loading}
        >
          {result?.products.map(card)}
        </div>
        {!loading &&
          result &&
          result.total === 0 &&
          !result.unresolved.length && (
            <div className="s-empty">
              <Search size={36} />
              <h3>No matching products</h3>
              <p>
                Try a different product name or change a filter. Required
                declarations are never assumed.
              </p>
              <button
                className="s-button"
                onClick={() => {
                  setClaims([]);
                  setBrand("");
                  setGroup("All products");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        {result && result.pages > 1 && (
          <nav className="s-pagination" aria-label="Product pages">
            <button
              disabled={page === 1 || loading}
              onClick={() => {
                setPage((p) => p - 1);
                window.scrollTo({ top: 250 });
              }}
            >
              <ArrowLeft size={16} /> Previous
            </button>
            <span>
              Page {page} of {result.pages}
            </span>
            <button
              disabled={page >= result.pages || loading}
              onClick={() => {
                setPage((p) => p + 1);
                window.scrollTo({ top: 250 });
              }}
            >
              Next <ArrowRight size={16} />
            </button>
          </nav>
        )}
        <div className="s-catalog-note">
          <Package size={15} />
          <span>
            Supplier product data · Verified images where available · Missing
            declarations remain unknown
          </span>
        </div>
      </main>
      <footer className="s-footer">
        <img src="/store/aimo-logo.svg" alt="Valio Aimo" />
        <p>For people who make good food happen.</p>
        <span>Independent hackathon prototype · Simulated purchasing</span>
        <Link href="/operations">
          Open purchasing controls <ArrowRight size={15} />
        </Link>
      </footer>
      {compare.length > 0 && (
        <div className="s-compare-tray">
          <Scale size={22} />
          <span>
            <strong>{compare.length} products selected</strong>
            <small>Compare packs, declarations and prices</small>
          </span>
          <button
            className="s-button"
            onClick={() => setView({ kind: "compare" })}
          >
            Compare products <ArrowRight size={16} />
          </button>
          <button
            className="s-icon"
            aria-label="Clear comparison"
            onClick={() => setCompare([])}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {toast && (
        <div className="s-toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          {previous && <button onClick={undo}>Undo</button>}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {savedOpen && (
        <Drawer title="Saved baskets" close={() => setSavedOpen(false)}>
          {saved.length ? (
            saved.map((list, i) => (
              <div className="s-saved" key={i}>
                <strong>
                  Basket {i + 1} · {list.length} products
                </strong>
                <p>
                  {list
                    .slice(0, 3)
                    .map((l) => productName(l.product))
                    .join(", ")}
                </p>
                <button
                  className="s-button"
                  onClick={() => {
                    changeCart(
                      list,
                      "Saved basket restored. Current offers will be checked.",
                    );
                    setSavedOpen(false);
                    setView({ kind: "cart" });
                  }}
                >
                  Use this basket <ArrowRight size={16} />
                </button>
              </div>
            ))
          ) : (
            <div className="s-empty">
              <Heart size={30} />
              <h3>Keep a good basket handy.</h3>
              <p>Add products, then save your basket for next time.</p>
            </div>
          )}
        </Drawer>
      )}
      {view?.kind === "detail" && (
        <Drawer title="Product details" close={() => setView(null)}>
          <div className="s-detail">
            <ProductMedia product={view.product} />
            <span className="s-brand">{view.product.brand}</span>
            <h2>{productName(view.product)}</h2>
            <p>
              {packText(view.product)} · Product {view.product.id}
            </p>
            <div className="s-detail-price">
              <strong>
                {offers[view.product.id]?.price
                  ? money(offers[view.product.id]!.price!.value)
                  : "Price unconfirmed"}
              </strong>
              <span>/ {unitLabel(view.product.salesUnit)}</span>
            </div>
            <p className="s-stock">
              {stock(offers[view.product.id], date).label}
            </p>
            <button
              className="s-button primary"
              disabled={
                stock(offers[view.product.id], date).status === "blocked"
              }
              onClick={() => add(view.product)}
            >
              Add to basket <Plus size={18} />
            </button>
            <button
              className="s-button"
              onClick={() => openAlternatives(view.product)}
            >
              Find alternatives <SlidersHorizontal size={17} />
            </button>
            <div className="s-detail-claims">
              {view.product.claims.map((c) => (
                <span key={c}>
                  {labels[c] || c.toLowerCase().replaceAll("_", " ")}
                </span>
              ))}
            </div>
            {[
              ["About this product", view.product.details?.descriptions],
              ["Ingredients", view.product.details?.ingredients],
              ["How to use", view.product.details?.usage],
              ["Preparation", view.product.details?.preparation],
              ["Storage", view.product.details?.storage],
            ].map(([title, text]) => {
              const t = text as Record<string, string> | undefined;
              return t && (t.en || t.fi) ? (
                <section key={title as string}>
                  <h3>{title as string}</h3>
                  <p>{t.en || t.fi}</p>
                </section>
              ) : null;
            })}
            <section>
              <h3>Supplier allergen declarations</h3>
              <p>
                {view.product.allergens.join(", ") ||
                  "No declarations provided. This does not mean allergen-free."}
              </p>
              <small>
                Supplier codes are shown unchanged. Check the complete product
                information for dietary suitability.
              </small>
            </section>
            <dl>
              <dt>GTIN</dt>
              <dd>{view.product.gtin || "Not supplied"}</dd>
              <dt>Historical delivery reliability</dt>
              <dd>
                {view.product.reliability !== undefined
                  ? `${(view.product.reliability * 100).toFixed(1)}%`
                  : "Unknown"}
              </dd>
              <dt>Carbon footprint</dt>
              <dd>
                {view.product.carbonKgPerKg !== undefined
                  ? `${view.product.carbonKgPerKg} kg CO₂e/kg`
                  : "Unknown"}
              </dd>
            </dl>
          </div>
        </Drawer>
      )}
      {view?.kind === "compare" && (
        <Drawer
          title="A closer look at your choices"
          wide
          close={() => setView(null)}
        >
          <p className="s-panel-intro">
            Supplier facts side by side. Prices and availability refer to your
            requested delivery date.
          </p>
          <div className="s-compare-grid">
            {compare.map((p) => (
              <article key={p.id}>
                <ProductMedia product={p} />
                <h3>{productName(p)}</h3>
                <dl>
                  <dt>Sales pack</dt>
                  <dd>{packText(p)}</dd>
                  <dt>Price per {unitLabel(p.salesUnit)}</dt>
                  <dd>
                    {offers[p.id]?.price
                      ? money(offers[p.id]!.price!.value)
                      : "Unconfirmed"}
                  </dd>
                  <dt>Comparison price</dt>
                  <dd>
                    {offers[p.id]?.price && p.pack.content
                      ? `${money(offers[p.id]!.price!.value / p.pack.content.value)} / ${p.pack.content.unit}`
                      : "Conversion unknown"}
                  </dd>
                  <dt>Availability</dt>
                  <dd>{stock(offers[p.id], date).label}</dd>
                  <dt>Dietary declarations</dt>
                  <dd>
                    {p.claims
                      .filter((c) => labels[c])
                      .map((c) => labels[c])
                      .join(", ") || "Not declared"}
                  </dd>
                  <dt>Supplier use information</dt>
                  <dd>
                    {p.details?.usage.en ||
                      p.details?.usage.fi ||
                      "Not supplied"}
                  </dd>
                </dl>
                <button
                  className="s-button primary"
                  onClick={() => add(p)}
                  disabled={stock(offers[p.id], date).status === "blocked"}
                >
                  Add to basket <Plus size={17} />
                </button>
              </article>
            ))}
          </div>
        </Drawer>
      )}
      {view?.kind === "alternatives" && (
        <Drawer title="Find another fit" wide close={() => setView(null)}>
          <div className="s-original">
            <ProductMedia product={view.product} />
            <div>
              <small>CURRENT PRODUCT</small>
              <h3>{productName(view.product)}</h3>
              <p>{packText(view.product)}</p>
            </div>
          </div>
          <p className="s-panel-intro">
            Candidates preserve the original product’s explicit dietary
            properties. Check recipe suitability and availability before
            choosing.
          </p>
          {alternativesBusy ? (
            <p className="s-panel-intro">Finding alternatives…</p>
          ) : alternatives.length ? (
            <div className="s-alternatives">
              {alternatives.map((p) => (
                <article key={p.id}>
                  <ProductMedia product={p} />
                  <div>
                    <small>{p.reasons[0]}</small>
                    <h3>{productName(p)}</h3>
                    <p>{packText(p)}</p>
                    <strong>
                      {offers[p.id]?.price
                        ? money(offers[p.id]!.price!.value)
                        : "Price unconfirmed"}
                    </strong>
                    <p>{stock(offers[p.id], date).label}</p>
                    {(() => {
                      const line = cart.find(
                        (l) => l.product.id === view.product.id,
                      );
                      if (!line) return null;
                      const r = replacement(line, p);
                      if (!r)
                        return (
                          <p>Pack conversion or required claims unconfirmed.</p>
                        );
                      const a = offers[view.product.id]?.price?.value,
                        b = offers[p.id]?.price?.value;
                      return (
                        <p className="s-replacement-impact">
                          {line.qty} {unitLabel(view.product.salesUnit)} →{" "}
                          {r.qty} {unitLabel(p.salesUnit)} · {r.excess} {r.unit}{" "}
                          extra
                          {a !== undefined && b !== undefined
                            ? ` · ${money((cents(r.qty, b) - cents(line.qty, a)) / 100)} change`
                            : " · price difference unconfirmed"}
                        </p>
                      );
                    })()}
                    <button
                      className="s-button"
                      disabled={
                        stock(offers[p.id], date).status === "blocked" ||
                        !!(
                          cart.find((l) => l.product.id === view.product.id) &&
                          !replacement(
                            cart.find((l) => l.product.id === view.product.id)!,
                            p,
                          )
                        )
                      }
                      onClick={() => replace(view.product, p)}
                    >
                      {cart.some((l) => l.product.id === view.product.id)
                        ? "Use this replacement"
                        : "Add this product"}{" "}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="s-empty">
              <Package size={30} />
              <h3>No verified candidate found</h3>
              <p>
                Try browsing a broader selection, keeping your dietary
                requirements in mind.
              </p>
            </div>
          )}
        </Drawer>
      )}
      {view?.kind === "cart" && (
        <Drawer title="Your basket" close={() => setView(null)}>
          <div className="s-cart-context">
            <Truck size={18} />
            <span>Requested delivery: {date}</span>
            <button
              onClick={() => {
                setView(null);
                setDateOpen(true);
              }}
            >
              Change
            </button>
          </div>
          {previous && (
            <button className="s-button" disabled={submitting} onClick={undo}>
              <RotateCcw size={16} /> Undo last basket change
            </button>
          )}
          {cart.length ? (
            <>
              <div className="s-cart-lines">
                {cart.map((l) => (
                  <article key={l.product.id}>
                    <ProductMedia product={l.product} />
                    <div>
                      <strong>{productName(l.product)}</strong>
                      <small>{packText(l.product)}</small>
                      <div className="s-quantity">
                        <button
                          aria-label={`Remove one ${productName(l.product)}`}
                          disabled={submitting}
                          onClick={() =>
                            setQuantity(
                              l.product,
                              Math.max(0, l.qty - minimum(l.product)),
                            )
                          }
                        >
                          <Minus size={15} />
                        </button>
                        <input
                          key={`${l.product.id}-${l.qty}`}
                          aria-label={`Quantity of ${productName(l.product)}`}
                          type="number"
                          min="0"
                          max="100000"
                          step={minimum(l.product)}
                          defaultValue={l.qty}
                          disabled={submitting}
                          onBlur={(e) => {
                            if (Number(e.target.value) !== l.qty)
                              setQuantity(l.product, Number(e.target.value));
                            e.target.value = String(
                              cart.find((x) => x.product.id === l.product.id)
                                ?.qty || l.qty,
                            );
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                        />
                        <button
                          aria-label={`Add one ${productName(l.product)}`}
                          disabled={submitting}
                          onClick={() => add(l.product)}
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                      <button
                        className="s-text-link"
                        onClick={() => openAlternatives(l.product)}
                      >
                        Alternatives
                      </button>
                    </div>
                    <strong>
                      {offers[l.product.id]?.price
                        ? money(
                            cents(l.qty, offers[l.product.id]!.price!.value) /
                              100,
                          )
                        : "—"}
                    </strong>
                  </article>
                ))}
              </div>
              <div className="s-cart-summary">
                <div>
                  <span>
                    {complete ? "Basket total" : "Known-price subtotal"}
                  </span>
                  <strong>{money(total)}</strong>
                </div>
                <small>
                  Excl. VAT ·{" "}
                  {context?.source === "valio" ? "Challenge API" : "Demo"}{" "}
                  prices · No real order is placed
                </small>
                <button
                  className="s-button primary"
                  disabled={!complete || pricing || submitting || !!proposal}
                  onClick={checkout}
                >
                  {submitting ? (
                    <>
                      <LoaderCircle className="spin" size={17} /> Checking your
                      basket
                    </>
                  ) : (
                    <>
                      Request human approval <ArrowRight size={17} />
                    </>
                  )}
                </button>
                <button
                  className="s-button"
                  onClick={() => {
                    setSaved((s) => [structuredClone(cart), ...s].slice(0, 8));
                    setToast("Basket saved on this browser.");
                  }}
                >
                  <Heart size={16} /> Save this basket
                </button>
                {checkoutError && (
                  <p className="s-error" role="alert">
                    {checkoutError}
                  </p>
                )}
                {proposal && (
                  <div className="s-proposal-result">
                    <strong>
                      {proposal.status === "held"
                        ? "Sent for human review"
                        : proposal.status === "refused"
                          ? "Basket needs changes"
                          : `Proposal: ${proposal.status}`}
                    </strong>
                    <p>
                      {proposal.verdict.firedRules
                        .map((r) => r.message)
                        .join(" ")}
                    </p>
                    <Link href="/operations">
                      Open human approval workspace <ArrowRight size={15} />
                    </Link>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="s-empty">
              <ShoppingCart size={36} />
              <h3>Ready when you are.</h3>
              <p>Find your products and add them here.</p>
              <button className="s-button" onClick={() => setView(null)}>
                Explore products
              </button>
            </div>
          )}
        </Drawer>
      )}
    </div>
  );
}
