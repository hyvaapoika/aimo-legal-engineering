"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  Bookmark,
  CalendarDays,
  Check,
  CheckCheck,
  ChefHat,
  ChevronDown,
  CircleHelp,
  CookingPot,
  Leaf,
  Milk,
  Minus,
  Package,
  Plus,
  Search,
  Settings2,
  ShoppingBasket,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  UsersRound,
  Wheat,
  X,
} from "lucide-react";
import { useDialog } from "../components/use-dialog";
import {
  compatibleReplacement,
  euros,
  makeLunch,
  replacementQuantity,
  productById,
  products,
  recipe,
  replaceProduct,
  restoreDraft,
  setQuantity,
  totalCents,
  type KitchenDraft,
  type KitchenProduct,
} from "./state";
import "./kitchen.css";
import "./workspace.css";
import {
  applyProposal,
  proposePortions,
  proposeSavings,
  type KitchenProposal,
} from "./proposals";

type AssistantView =
  "welcome" | "replace" | "explain" | "message" | "diet" | "proposal";
type SavedLunch = { name: string; draft: KitchenDraft };
const storageKey = "aimo-chef-preview-v1";
const kinds = {
  pasta: Wheat,
  tomatoes: CookingPot,
  cream: Milk,
  cheese: Package,
  butter: Package,
  basil: Leaf,
};

function ProductImage({
  product,
  small = false,
}: {
  product: KitchenProduct;
  small?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const Icon = kinds[product.kind as keyof typeof kinds] ?? Package;
  return (
    <div
      className={`k-product-image ${small ? "small" : ""} kind-${product.kind}`}
    >
      {product.image && !failed ? (
        <img
          src={product.image}
          alt={`${product.brand} ${product.title}, ${product.packLabel}`}
          onError={() => setFailed(true)}
          loading="lazy"
        />
      ) : (
        <div className="k-photo-fallback">
          <Icon size={small ? 25 : 43} strokeWidth={1.25} />
          <span>Photo unavailable</span>
        </div>
      )}
    </div>
  );
}

function Quantity({
  value,
  name,
  onChange,
}: {
  value: number;
  name: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="k-quantity">
      <button
        aria-label={`Remove one ${name}`}
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={!value}
      >
        <Minus size={15} />
      </button>
      <span aria-label={`${value} packs`}>{value}</span>
      <button
        aria-label={`Add one ${name}`}
        onClick={() => onChange(value + 1)}
        disabled={value >= 10000}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

function Cart({
  draft,
  close,
  update,
  compare,
}: {
  draft: KitchenDraft;
  close: () => void;
  update: (id: string, qty: number) => void;
  compare: (id: string) => void;
}) {
  const ref = useDialog(close);
  const missing = draft.lines.filter(
    (l) => productById(l.productId)!.unavailable,
  );
  const [exported, setExported] = useState(false);
  const exportDraft = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            status: "design-preview-not-an-order",
            priceSource: "illustrative",
            ...draft,
            totalCents: totalCents(draft),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "aimo-lunch-draft.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(true);
  };
  return (
    <div className="k-overlay" onClick={close}>
      <section
        ref={ref}
        className="k-cart-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="k-cart-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="k-drawer-heading">
          <div>
            <span className="k-overline">YOUR KITCHEN</span>
            <h2 id="k-cart-title">Your lunch basket</h2>
          </div>
          <button className="k-icon" aria-label="Close cart" onClick={close}>
            <X />
          </button>
        </div>
        <div className="k-cart-context">
          <UsersRound size={17} /> {draft.portions} planned portions{" "}
          <span>•</span> {draft.lines.length} products
        </div>
        <div className="k-cart-lines">
          {draft.lines.length ? (
            draft.lines.map((line) => {
              const p = productById(line.productId)!;
              return (
                <div className="k-cart-line" key={p.id}>
                  <ProductImage product={p} small />
                  <div>
                    <strong>{p.title}</strong>
                    <p>
                      {p.brand} · {p.packLabel}
                    </p>
                    {p.unavailable ? (
                      <button
                        className="k-text amber"
                        onClick={() => {
                          close();
                          compare(p.id);
                        }}
                      >
                        Choose a replacement <ArrowRight size={14} />
                      </button>
                    ) : (
                      <Quantity
                        name={p.title}
                        value={line.qty}
                        onChange={(v) => update(p.id, v)}
                      />
                    )}
                  </div>
                  <strong>{euros(p.priceCents * line.qty)}</strong>
                </div>
              );
            })
          ) : (
            <div className="k-empty">
              <ShoppingBasket size={32} />
              <h3>Your basket is empty</h3>
              <p>Add a product or start with the sample lunch.</p>
            </div>
          )}
        </div>
        <div className="k-cart-bottom">
          {missing.length > 0 && (
            <p className="k-cart-warning">
              Choose {missing.length} replacement before your basket is ready.
            </p>
          )}
          <div>
            <span>Sample total, excl. VAT</span>
            <strong>{euros(totalCents(draft))}</strong>
          </div>
          <p>
            Design preview. Prices and availability are examples; no order will
            be placed.
          </p>
          <button
            className="k-button primary"
            disabled={!draft.lines.length || !!missing.length}
            onClick={exportDraft}
          >
            <ArrowDownToLine size={18} />{" "}
            {exported ? "Draft exported" : "Export this draft"}
          </button>
          <Link className="k-text" href="/operations">
            Open purchasing & approvals <ArrowRight size={15} />
          </Link>
        </div>
      </section>
    </div>
  );
}

function ProductDetail({
  product: p,
  close,
  add,
}: {
  product: KitchenProduct;
  close: () => void;
  add: () => void;
}) {
  const ref = useDialog(close);
  const labels: Record<string, string> = {
    FREE_FROM_LACTOSE: "Lactose-free",
    FREE_FROM_GLUTEN: "Gluten-free",
    VEGETARIAN: "Vegetarian",
    VEGAN: "Vegan",
  };
  return (
    <div className="k-overlay" onClick={close}>
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="k-detail-title"
        className="k-detail"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="k-icon k-detail-close"
          aria-label="Close product details"
          onClick={close}
        >
          <X />
        </button>
        <ProductImage product={p} />
        <span className="k-overline">
          {p.brand} · {p.id}
        </span>
        <h2 id="k-detail-title">{p.title}</h2>
        <p>{p.supplierName}</p>
        <div className="k-tags">
          {p.claims
            .filter((c) => labels[c])
            .map((c) => (
              <span key={c}>{labels[c]}</span>
            ))}
        </div>
        <dl>
          <div>
            <dt>Sales pack</dt>
            <dd>{p.packLabel}</dd>
          </div>
          <div>
            <dt>Sample price</dt>
            <dd>{euros(p.priceCents)}</dd>
          </div>
          <div>
            <dt>Supplier allergen codes</dt>
            <dd>{p.allergens.join(", ") || "Not declared in this record"}</dd>
          </div>
        </dl>
        <p className="k-fine">
          Missing declarations do not mean allergen-free. Product information
          comes from the supplied catalogue; prices and availability are preview
          fixtures.
        </p>
        <button
          className="k-button primary"
          disabled={p.unavailable}
          onClick={add}
        >
          {p.unavailable ? "Unavailable in this scenario" : "Add one pack"}{" "}
          <Plus size={18} />
        </button>
      </section>
    </div>
  );
}

export default function Kitchen() {
  const [draft, setDraft] = useState<KitchenDraft>(() => makeLunch(120));
  const [previous, setPrevious] = useState<KitchenDraft>();
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<SavedLunch[]>([]);
  const [tab, setTab] = useState<"lunch" | "shop" | "saved">("lunch");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All products");
  const [cart, setCart] = useState(false);
  const [detail, setDetail] = useState<KitchenProduct>();
  const [assistant, setAssistant] = useState<AssistantView>("welcome");
  const [proposal, setProposal] = useState<KitchenProposal>();
  const [lastRequest, setLastRequest] = useState("");
  const [targetId, setTargetId] = useState("465046");
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [delivery, setDelivery] = useState("Next service");
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || "null");
      const existing = restoreDraft(raw?.draft);
      if (existing) setDraft(existing);
      if (Array.isArray(raw?.saved))
        setSaved(
          raw.saved.slice(0, 8).flatMap((s: SavedLunch) => {
            const d = restoreDraft(s?.draft);
            return d && typeof s.name === "string"
              ? [{ name: s.name.slice(0, 80), draft: d }]
              : [];
          }),
        );
    } catch {
      /* A damaged browser draft must not break the workspace. */
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ draft, saved }));
      } catch {
        /* Workspace remains usable without browser persistence. */
      }
    }
  }, [draft, saved, ready]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(t);
  }, [notice]);
  const change = (next: KitchenDraft, text: string) => {
    setProposal(undefined);
    if (assistant === "proposal") setAssistant("welcome");
    setPrevious(draft);
    setDraft(next);
    setNotice(text);
  };
  const undo = () => {
    if (previous) {
      setDraft(previous);
      setPrevious(undefined);
      setAssistant("welcome");
      setMessage("");
      setNotice("Last basket change undone.");
    }
  };
  const qty = (id: string) =>
    draft.lines.find((l) => l.productId === id)?.qty ?? 0;
  const update = (id: string, value: number) => {
    try {
      change(
        setQuantity(draft, id, value),
        value ? "Basket updated." : "Product removed. Use Undo to restore it.",
      );
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const scale = (n: number) => {
    try {
      setProposal(proposePortions(draft, n));
      setLastRequest(`Make it ${n} portions`);
      setAssistant("proposal");
      setTab("lunch");
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const cheaper = () => {
    setProposal(proposeSavings(draft));
    setLastRequest("Can we make it cheaper?");
    setAssistant("proposal");
    setTab("lunch");
  };
  const acceptProposal = () => {
    if (!proposal) return;
    try {
      change(applyProposal(draft, proposal), "Changes applied to your basket.");
      setAssistant("welcome");
      setLastRequest("");
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const openAssistant = (view: AssistantView, id?: string) => {
    if (id) setTargetId(id);
    setAssistant(view);
    setTab("lunch");
  };
  const compare = (id: string) => {
    setLastRequest(
      `Find an alternative for ${productById(id)!.title.toLowerCase()}`,
    );
    openAssistant("replace", id);
  };
  const selectReplacement = (p: KitchenProduct) => {
    try {
      const before = totalCents(draft);
      const next = replaceProduct(draft, targetId, p.id);
      change(next, `${p.brand} ${p.title} selected.`);
      const difference = totalCents(next) - before;
      setMessage(
        `Replaced with ${p.brand} ${p.title}. ${difference < 0 ? `Your sample basket is ${euros(-difference)} less.` : difference > 0 ? `Sample basket increases by ${euros(difference)}.` : "The sample basket price stays the same."}`,
      );
      setAssistant("message");
    } catch (e) {
      setMessage((e as Error).message);
      setAssistant("message");
    }
  };
  const save = () => {
    setSaved((s) =>
      [
        {
          name: `Tomato pasta · ${draft.portions} portions`,
          draft: structuredClone(draft),
        },
        ...s,
      ].slice(0, 8),
    );
    setNotice("Lunch saved to your lists on this browser.");
  };
  const ask = (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    setTab("lunch");
    setLastRequest(text);
    const lower = text.toLowerCase();
    const n =
      lower.match(/\b(\d+)\s*(?:portions?|people|guests?|servings?)\b/) ??
      lower.match(/make it\s+(\d+)/);
    if (
      /\btomato pasta\b/.test(lower) &&
      /\bfor\s+\d+/.test(lower) &&
      !/\b(?:not|don't|if)\b/.test(lower)
    ) {
      const portions = Number(lower.match(/\bfor\s+(\d+)/)?.[1]);
      scale(portions);
      return;
    }
    if (/gluten|allerg|vegan|diet/.test(lower)) {
      openAssistant("diet");
      return;
    }
    if (
      n &&
      /^(?:please )?(?:make|set|change|scale|prepare|cook)\b/.test(lower) &&
      !/\b(?:not|don't|if)\b/.test(lower)
    ) {
      scale(Number(n[1]));
      return;
    }
    if (/cheaper|save money|reduce.*cost|lower.*cost/.test(lower)) {
      cheaper();
      return;
    }
    if (/alternative|replace|unavailable|swap|compare/.test(lower)) {
      const kind = /cheese/.test(lower)
        ? "cheese"
        : /pasta|penne/.test(lower)
          ? "pasta"
          : /cream/.test(lower)
            ? "cream"
            : "tomatoes";
      const line = draft.lines.find(
        (l) => productById(l.productId)?.kind === kind,
      );
      if (line) {
        compare(line.productId);
        return;
      }
    }
    if (/why|explain|packs/.test(lower)) {
      openAssistant("explain", draft.lines[0]?.productId ?? "475437");
      return;
    }
    if (/cart|basket|total/.test(lower)) {
      setMessage(
        `Your sample basket has ${draft.lines.length} products and totals ${euros(totalCents(draft))}, excluding VAT.`,
      );
      setAssistant("message");
      return;
    }
    if (/show|find|search/.test(lower)) {
      const term = lower
        .replace(/\b(show|find|search|me|for|products)\b/g, "")
        .trim();
      setQuery(term);
      setTab("shop");
      setMessage(`Showing catalogue matches for “${term}”.`);
      setAssistant("message");
      return;
    }
    setMessage(
      "This design preview supports changing portions, finding products, comparing replacements and explaining packs. Try one of the quick actions below.",
    );
    setAssistant("message");
  };
  const unavailable = draft.lines.filter(
    (l) => productById(l.productId)!.unavailable,
  );
  const activeProducts =
    tab === "lunch"
      ? draft.lines.map((l) => productById(l.productId)!)
      : products;
  const shown = activeProducts.filter(
    (p) =>
      (category === "All products" || p.category === category) &&
      `${p.title} ${p.brand} ${p.supplierName} ${p.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const target = productById(targetId)!;
  const alternatives = qty(target.id)
    ? products.filter((p) => compatibleReplacement(target, p))
    : [];
  const total = totalCents(draft);
  const explainProduct = productById(targetId)!;
  const coefficient = recipe.find((r) => r.kind === explainProduct.kind);
  return (
    <div className="kitchen workspace-ui">
      <header className="k-header">
        <Link href="/" className="k-logo" aria-label="Aimo kitchen home">
          aimo<span>by Valio</span>
        </Link>
        <nav aria-label="Main navigation">
          <button
            className={tab === "lunch" ? "active" : ""}
            onClick={() => {
              setTab("lunch");
              setQuery("");
              setCategory("All products");
            }}
          >
            <ChefHat size={18} /> Your lunch
          </button>
          <button
            className={tab === "shop" ? "active" : ""}
            onClick={() => {
              setTab("shop");
              setQuery("");
              setCategory("All products");
            }}
          >
            Shop products
          </button>
          <button
            className={tab === "saved" ? "active" : ""}
            onClick={() => setTab("saved")}
          >
            Saved lists {saved.length > 0 && <span>{saved.length}</span>}
          </button>
        </nav>
        <div className="k-header-actions">
          <Link href="/operations" className="k-operations">
            Operations <ArrowRight size={14} />
          </Link>
          <button className="k-cart-trigger" onClick={() => setCart(true)}>
            <ShoppingBasket size={20} />
            <span>Basket</span>
            <b>{draft.lines.length}</b>
          </button>
          <div className="k-avatar" aria-label="Demo kitchen">
            HH
          </div>
        </div>
      </header>
      <div className="k-context">
        <span>
          <span className="k-dot" /> Hotel Haven · Demo kitchen
        </span>
        <span className="k-preview">
          Interactive preview <span>·</span> Sample prices & availability
        </span>
      </div>
      <div className="k-workspace">
        <main className="k-main" data-view={tab}>
          <div className="k-page-heading">
            <div>
              <span className="k-overline">YOUR KITCHEN WORKSPACE</span>
              <h1>
                {tab === "shop"
                  ? "Find your next ingredient."
                  : tab === "saved"
                    ? "Good lunches, on repeat."
                    : "What’s on the menu?"}
              </h1>
              <p>
                {tab === "shop"
                  ? "Familiar products. Useful choices. All in one basket."
                  : tab === "saved"
                    ? "Your saved plans, ready for another service."
                    : "Plan a service. Make a few changes. Get back to cooking."}
              </p>
            </div>
            <button
              className="k-button quiet"
              onClick={() => setSettings(!settings)}
              aria-label="Kitchen preferences"
              aria-expanded={settings}
            >
              <Settings2 size={17} />
              <span>Kitchen preferences</span>
            </button>
          </div>
          {settings && (
            <div className="k-preferences">
              <div>
                <h3>For this preview</h3>
                <p>
                  Prices exclude VAT. Dietary requests need ingredient-level
                  verification.
                </p>
              </div>
              <label>
                Planned delivery
                <select
                  value={delivery}
                  onChange={(e) => setDelivery(e.target.value)}
                >
                  <option>Next service</option>
                  <option>In two days</option>
                  <option>Next week</option>
                </select>
              </label>
              <button
                className="k-button quiet"
                onClick={() => {
                  change(makeLunch(120), "Sample lunch restored.");
                  setAssistant("welcome");
                  setTab("lunch");
                  setQuery("");
                  setCategory("All products");
                  setSettings(false);
                }}
              >
                Start sample lunch
              </button>
              <button
                className="k-icon"
                aria-label="Close preferences"
                onClick={() => setSettings(false)}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {tab === "lunch" && (
            <section className="w-request" aria-label="Lunch request">
              <form onSubmit={ask}>
                <Sparkles size={24} />
                <label className="k-sr-only" htmlFor="w-request">
                  What would you like to change?
                </label>
                <input
                  id="w-request"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Try ‘tomato pasta for 150’…"
                  autoComplete="off"
                />
                <button
                  type="submit"
                  aria-label="Send request"
                  disabled={!input.trim()}
                >
                  <ArrowUp size={21} />
                </button>
              </form>
              <div className="w-request-hints">
                <span>Try a request, or choose a task</span>
                <small>Guided UI preview · no live AI</small>
              </div>
              <div className="w-task-chips">
                <button onClick={() => scale(150)}>
                  <UsersRound size={16} /> Make it 150
                </button>
                <button onClick={cheaper}>
                  <SlidersHorizontal size={16} /> Make it cheaper
                </button>
                <button
                  onClick={() => {
                    setLastRequest("Check dietary needs");
                    openAssistant("diet");
                  }}
                >
                  <Leaf size={16} /> Dietary needs
                </button>
                <button
                  onClick={() => {
                    setTab("shop");
                    setQuery("");
                    setCategory("All products");
                  }}
                >
                  <Plus size={16} /> Add an ingredient
                </button>
              </div>
            </section>
          )}
          {tab === "lunch" && assistant !== "welcome" && (
            <section className="w-response" aria-label="Interactive response">
              <div className="w-response-top">
                <span>
                  <Sparkles size={16} />
                  {lastRequest || "Working on your lunch"}
                </span>
                <button
                  onClick={() => {
                    setAssistant("welcome");
                    setProposal(undefined);
                    setLastRequest("");
                  }}
                  aria-label="Back to lunch plan"
                >
                  <X size={19} />
                </button>
              </div>
              <div
                className={`w-response-body k-assistant-content view-${assistant}`}
              >
                {assistant === "replace" && (
                  <>
                    <h3>A good fit for your {target.kind}.</h3>
                    <p>
                      {target.unavailable
                        ? "Your original product stays in the basket until you choose a replacement."
                        : "Compare a different pack or product before making a change."}
                    </p>
                    <div className="k-original">
                      <span>Currently selected</span>
                      <strong>
                        {target.brand} · {target.packLabel}
                      </strong>
                    </div>
                    <div className="w-options">
                      {alternatives.length ? (
                        alternatives.map((p, index) => {
                          const count = replacementQuantity(
                            draft,
                            target.id,
                            p.id,
                          );
                          const delta =
                            p.priceCents * count -
                            target.priceCents * qty(target.id);
                          return (
                            <article className="k-option" key={p.id}>
                              <div className="k-option-label">
                                {index === 0
                                  ? "Same ingredient"
                                  : "Another pack size"}
                              </div>
                              <div className="k-option-product">
                                <ProductImage product={p} small />
                                <div>
                                  <span>{p.brand}</span>
                                  <strong>{p.title}</strong>
                                  <p>
                                    {p.packLabel} · {euros(p.priceCents)}/pack
                                  </p>
                                </div>
                              </div>
                              <div className="k-option-facts">
                                <span>
                                  {count}{" "}
                                  {p.salesUnit === "KI" ? "cases" : "packs"} for{" "}
                                  {draft.portions} portions
                                </span>
                                <strong className={delta <= 0 ? "saving" : ""}>
                                  {delta <= 0
                                    ? `${euros(-delta)} less`
                                    : `+${euros(delta)}`}{" "}
                                  <small>basket difference</small>
                                </strong>
                              </div>
                              {p.kind === "pasta" && (
                                <p className="k-fine">
                                  Check recipe and dietary suitability before
                                  changing pasta.
                                </p>
                              )}
                              <button
                                className="k-button quiet"
                                onClick={() => selectReplacement(p)}
                              >
                                Use this product <ArrowRight size={15} />
                              </button>
                            </article>
                          );
                        })
                      ) : (
                        <div className="k-assistant-alert">
                          <strong>
                            No alternative in this preview selection.
                          </strong>
                          <p>
                            Keep this product or browse the full catalogue in
                            Operations.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
                {assistant === "message" && (
                  <>
                    <h3>Workspace update</h3>
                    <p>{message}</p>
                    {previous && (
                      <button className="k-text" onClick={undo}>
                        <Undo2 size={15} /> Undo last basket change
                      </button>
                    )}
                    <button
                      className="k-button quiet k-review-inline"
                      onClick={() => setCart(true)}
                    >
                      Review my basket <ShoppingBasket size={16} />
                    </button>
                  </>
                )}
                {assistant === "explain" && (
                  <>
                    <h3>Just enough. In whole packs.</h3>
                    <p>
                      {coefficient
                        ? `The sample recipe uses ${coefficient.amount} ${explainProduct.measure} of ${explainProduct.kind} per portion. For ${draft.portions} portions, that’s ${((coefficient.amount * draft.portions) / 1000).toFixed(2)} ${explainProduct.measure === "ml" ? "L" : "kg"}.`
                        : "This item was added directly to the basket."}
                    </p>
                    <div className="k-assistant-alert">
                      <strong>
                        {qty(explainProduct.id)} × {explainProduct.packLabel}
                      </strong>
                      <p>
                        Your current selection:{" "}
                        {(
                          (qty(explainProduct.id) * explainProduct.packAmount) /
                          1000
                        ).toFixed(2)}{" "}
                        {explainProduct.measure === "ml" ? "L" : "kg"}.
                        Quantities are editable in the basket.
                      </p>
                    </div>
                    <p className="k-fine">
                      Illustrative recipe quantities. This is not a verified
                      portion or nutritional recommendation.
                    </p>
                  </>
                )}
                {assistant === "diet" && (
                  <>
                    <h3>Let’s check dietary needs.</h3>
                    <p>
                      We can show products with a supplier-declared gluten-free
                      claim. Changing pasta alone doesn’t verify the entire
                      meal.
                    </p>
                    {products
                      .filter(
                        (p) =>
                          p.kind === "pasta" &&
                          p.claims.includes("FREE_FROM_GLUTEN"),
                      )
                      .map((p) => (
                        <article className="k-option" key={p.id}>
                          <ProductImage product={p} small />
                          <strong>
                            {p.brand} {p.title}
                          </strong>
                          <p>
                            {p.packLabel} · {euros(p.priceCents)}
                          </p>
                          <button
                            className="k-button quiet"
                            onClick={() => setDetail(p)}
                          >
                            Review product details <ArrowRight size={15} />
                          </button>
                        </article>
                      ))}
                    <p className="k-fine">
                      Dietary group allocation is not connected in this UI
                      preview. No meal-wide free-from claim is made.
                    </p>
                  </>
                )}

                {assistant === "proposal" && proposal && (
                  <>
                    <div className="w-proposal-heading">
                      <div>
                        <span className="k-overline">PROPOSED CHANGES</span>
                        <h3>{proposal.title}</h3>
                        <p>
                          {proposal.kind === "portions"
                            ? "Whole packs recalculated from the sample recipe. Review before applying."
                            : "Lower-cost packs in this preview selection. Check product suitability before swapping."}
                        </p>
                      </div>
                      <span className="w-proposal-symbol">
                        {proposal.kind === "portions" ? (
                          <UsersRound size={28} />
                        ) : (
                          <SlidersHorizontal size={28} />
                        )}
                      </span>
                    </div>
                    <div className="w-change-table">
                      {proposal.next.lines.map((line, index) => {
                        const before = proposal.base.lines[index]!;
                        const p = productById(line.productId)!;
                        const old = productById(before.productId)!;
                        if (
                          before.productId === line.productId &&
                          before.qty === line.qty
                        )
                          return null;
                        return (
                          <div className="w-change-row" key={line.productId}>
                            <ProductImage product={p} small />
                            <div>
                              <strong>{p.title}</strong>
                              <small>
                                {before.productId === line.productId
                                  ? p.packLabel
                                  : `${old.brand} ${old.packLabel} → ${p.brand} ${p.packLabel}`}
                              </small>
                            </div>
                            <span>
                              {before.qty} <ArrowRight size={14} />{" "}
                              <b>{line.qty} packs</b>
                            </span>
                            <strong>
                              {euros(
                                p.priceCents * line.qty -
                                  old.priceCents * before.qty,
                              )}
                            </strong>
                          </div>
                        );
                      })}
                    </div>
                    {JSON.stringify(proposal.base.lines) ===
                      JSON.stringify(proposal.next.lines) && (
                      <p className="w-no-changes">
                        {proposal.kind === "savings"
                          ? "No lower-cost compatible swap found in this selection."
                          : "Your existing packs already cover these portions."}
                      </p>
                    )}
                    <div className="w-proposal-total">
                      <span>
                        Basket total <s>{euros(totalCents(proposal.base))}</s>
                        <strong>{euros(totalCents(proposal.next))}</strong>
                      </span>
                      <span
                        className={
                          totalCents(proposal.next) < totalCents(proposal.base)
                            ? "saving"
                            : ""
                        }
                      >
                        {totalCents(proposal.next) < totalCents(proposal.base)
                          ? `Save ${euros(totalCents(proposal.base) - totalCents(proposal.next))}`
                          : `Difference ${euros(totalCents(proposal.next) - totalCents(proposal.base))}`}
                      </span>
                    </div>
                    <div className="w-proposal-actions">
                      <button
                        className="k-button quiet"
                        onClick={() => {
                          setAssistant("welcome");
                          setProposal(undefined);
                        }}
                      >
                        Keep current basket
                      </button>
                      <button
                        className="k-button primary"
                        disabled={
                          JSON.stringify(proposal.base) ===
                          JSON.stringify(proposal.next)
                        }
                        onClick={acceptProposal}
                      >
                        Apply changes <Check size={17} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </section>
          )}
          {tab === "saved" ? (
            <div className="k-saved-grid">
              {saved.length ? (
                saved.map((s, i) => (
                  <article className="k-saved-card" key={`${s.name}-${i}`}>
                    <div className="k-saved-icon">
                      <Bookmark size={28} />
                    </div>
                    <span className="k-overline">SAVED ON THIS BROWSER</span>
                    <h2>{s.name}</h2>
                    <p>
                      {s.draft.lines.length} ingredients ·{" "}
                      {euros(totalCents(s.draft))} sample total
                    </p>
                    <button
                      className="k-button primary"
                      onClick={() => {
                        change(
                          s.draft,
                          "Saved lunch restored. Preview availability is unchanged.",
                        );
                        setTab("lunch");
                      }}
                    >
                      Use this lunch <ArrowRight size={17} />
                    </button>
                  </article>
                ))
              ) : (
                <div className="k-empty">
                  <Bookmark size={35} />
                  <h2>A good lunch is worth saving.</h2>
                  <p>
                    Save your current plan, then reuse it for your next service.
                  </p>
                  <button className="k-button primary" onClick={save}>
                    Save current lunch <Plus size={17} />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {tab === "lunch" && (
                <section className="k-lunch-card">
                  <div className="k-lunch-photo">
                    <img
                      src="/kitchen/lunch.jpg"
                      alt="Serving inspiration: penne with tomato sauce and fresh basil"
                    />
                    <span>Serving inspiration</span>
                  </div>
                  <div className="k-lunch-copy">
                    <span className="k-overline">
                      <CookingPot size={14} /> YOUR LUNCH PLAN{" "}
                      <span className="k-sample-tag">Sample recipe</span>
                    </span>
                    <h2>Creamy tomato pasta</h2>
                    <p>A comforting classic. Ready for your next service.</p>
                    <div className="k-lunch-controls">
                      <label className="k-portions">
                        <UsersRound size={17} />
                        <input
                          aria-label="Number of portions"
                          type="number"
                          min="1"
                          max="1000"
                          key={draft.portions}
                          defaultValue={draft.portions}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isInteger(n) || n < 1 || n > 1000) {
                              e.target.value = String(draft.portions);
                              setNotice("Choose between 1 and 1,000 portions.");
                              return;
                            }
                            if (n !== draft.portions) scale(n);
                            e.target.value = String(draft.portions);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                        />
                        <span>portions</span>
                      </label>
                      <button
                        className="k-control"
                        onClick={() => setSettings(!settings)}
                      >
                        <CalendarDays size={16} /> {delivery}{" "}
                        <ChevronDown size={13} />
                      </button>
                      <button
                        className="k-control"
                        onClick={() => openAssistant("diet")}
                      >
                        <SlidersHorizontal size={15} /> Dietary needs
                      </button>
                    </div>
                  </div>
                  <button
                    className="k-save"
                    onClick={save}
                    aria-label="Save this lunch"
                  >
                    <Bookmark size={20} />
                  </button>
                </section>
              )}
              {(tab === "shop" || assistant === "welcome") && (
                <section className="k-product-section">
                  <div className="k-section-heading">
                    <div>
                      <h2>
                        {tab === "lunch"
                          ? "Your ingredient plan"
                          : "Shop the selection"}{" "}
                        <span>{shown.length}</span>
                      </h2>
                      <p>
                        {tab === "lunch"
                          ? "Sample recipe · Packs rounded up for your service."
                          : "A selection from the supplied Aimo catalogue."}
                      </p>
                    </div>
                    <div className="k-search">
                      <Search size={17} />
                      <input
                        aria-label="Search ingredients"
                        placeholder={
                          tab === "lunch"
                            ? "Find an ingredient…"
                            : "Search products or brands…"
                        }
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query && (
                        <button
                          aria-label="Clear search"
                          onClick={() => setQuery("")}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {tab === "shop" && (
                    <div className="k-categories">
                      {[
                        "All products",
                        "Dairy",
                        "Pantry",
                        "Pasta & grains",
                        "Fruit & veg",
                      ].map((c) => (
                        <button
                          key={c}
                          aria-pressed={category === c}
                          className={category === c ? "active" : ""}
                          onClick={() => setCategory(c)}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                  {tab === "lunch" && unavailable.length > 0 && (
                    <div className="k-attention">
                      <span>
                        <span className="k-attention-dot" />{" "}
                        {unavailable.length === 1
                          ? "One ingredient needs a little attention"
                          : `${unavailable.length} ingredients need attention`}
                      </span>
                      <button
                        onClick={() => compare(unavailable[0]!.productId)}
                      >
                        See alternatives <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                  {tab === "lunch" ? (
                    <div className="w-ingredient-list">
                      {shown.map((p) => (
                        <article
                          className={`w-ingredient-row ${p.unavailable ? "needs-swap" : ""}`}
                          key={p.id}
                        >
                          <button
                            className="w-product-thumb"
                            onClick={() => setDetail(p)}
                            aria-label={`View ${p.title}`}
                          >
                            <ProductImage product={p} small />
                          </button>
                          <div className="w-ingredient-name">
                            <button onClick={() => setDetail(p)}>
                              {p.title}
                            </button>
                            <small>
                              {p.brand} · {p.packLabel}
                            </small>
                          </div>
                          {p.unavailable ? (
                            <button
                              className="w-swap-action"
                              onClick={() => compare(p.id)}
                            >
                              Find replacement <ArrowRight size={15} />
                            </button>
                          ) : (
                            <Quantity
                              value={qty(p.id)}
                              name={p.title}
                              onChange={(n) => update(p.id, n)}
                            />
                          )}
                          <strong>{euros(p.priceCents * qty(p.id))}</strong>
                          {!p.unavailable && (
                            <button
                              className="k-icon"
                              aria-label={`Compare ${p.title}`}
                              onClick={() => compare(p.id)}
                            >
                              <SlidersHorizontal size={17} />
                            </button>
                          )}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="k-product-grid">
                      {shown.map((p) => (
                        <article
                          className={`k-product-card ${p.unavailable ? "unavailable" : ""}`}
                          key={p.id}
                        >
                          <div className="k-product-top">
                            <span
                              className={
                                p.unavailable
                                  ? "k-stock unavailable"
                                  : "k-stock"
                              }
                            >
                              {p.unavailable ? (
                                "Needs a replacement"
                              ) : (
                                <>
                                  <span /> Available in preview
                                </>
                              )}
                            </span>
                            <button
                              className="k-icon"
                              aria-label={`Details for ${p.title}`}
                              onClick={() => setDetail(p)}
                            >
                              <CircleHelp size={17} />
                            </button>
                          </div>
                          <button
                            className="k-image-button"
                            onClick={() => setDetail(p)}
                            aria-label={`View ${p.brand} ${p.title}`}
                          >
                            <ProductImage product={p} />
                          </button>
                          <div className="k-product-copy">
                            <span className="k-product-brand">{p.brand}</span>
                            <button
                              className="k-product-name"
                              onClick={() => setDetail(p)}
                            >
                              {p.title}
                            </button>
                            <p>
                              {p.packLabel}
                              {p.claims.includes("FREE_FROM_LACTOSE") &&
                                " · Lactose-free"}
                              {p.claims.includes("FREE_FROM_GLUTEN") &&
                                " · Gluten-free"}
                            </p>
                            <div className="k-product-price">
                              <strong>{euros(p.priceCents)}</strong>
                              <span>
                                / {p.salesUnit === "KI" ? "case" : "pack"}
                              </span>
                              <small>
                                {euros(
                                  Math.round(
                                    (p.priceCents * 1000) / p.packAmount,
                                  ),
                                )}
                                /{p.measure === "ml" ? "L" : "kg"}
                              </small>
                            </div>
                            <div className="k-product-actions">
                              {p.unavailable ? (
                                <button
                                  className="k-replace"
                                  onClick={() => compare(p.id)}
                                >
                                  Find a replacement <ArrowRight size={16} />
                                </button>
                              ) : (
                                <>
                                  <button
                                    className="k-swap"
                                    onClick={() =>
                                      qty(p.id)
                                        ? compare(p.id)
                                        : update(p.id, 1)
                                    }
                                  >
                                    {qty(p.id) ? "Swap" : "Add"}{" "}
                                    {qty(p.id) ? (
                                      <ChevronDown size={13} />
                                    ) : (
                                      <Plus size={15} />
                                    )}
                                  </button>
                                  <Quantity
                                    value={qty(p.id)}
                                    name={p.title}
                                    onChange={(n) => update(p.id, n)}
                                  />
                                </>
                              )}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  {!shown.length && (
                    <div className="k-empty">
                      <Search size={30} />
                      <h3>No ingredients found</h3>
                      <p>Try another name or clear your filters.</p>
                      <button
                        className="k-button quiet"
                        onClick={() => {
                          setQuery("");
                          setCategory("All products");
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                  {tab === "lunch" && (
                    <button
                      className="k-add-ingredient"
                      onClick={() => {
                        setTab("shop");
                        setQuery("");
                      }}
                    >
                      <Plus size={18} /> Add another ingredient
                    </button>
                  )}
                </section>
              )}
            </>
          )}
          <div className="k-main-footer">
            <span>
              <CheckCheck size={15} /> Product identities from the supplied
              catalogue
            </span>
            <Link href="/operations">
              Purchasing controls <ArrowRight size={14} />
            </Link>
          </div>
        </main>
        <aside className="w-basket" aria-label="Current basket">
          <div className="w-basket-title">
            <ShoppingBasket size={21} />
            <h2>Your basket</h2>
            <span>{draft.lines.length}</span>
          </div>
          <p>
            {draft.portions} portions · {delivery.toLowerCase()}
          </p>
          <div className="w-basket-lines">
            {draft.lines.map((line) => {
              const p = productById(line.productId)!;
              return (
                <button
                  key={p.id}
                  onClick={() => setDetail(p)}
                  className="w-basket-line"
                >
                  <ProductImage product={p} small />
                  <span>
                    <strong>{p.title}</strong>
                    <small>
                      {line.qty} × {p.packLabel}
                    </small>
                    {p.unavailable && <em>Replacement needed</em>}
                  </span>
                  <b>{euros(p.priceCents * line.qty)}</b>
                </button>
              );
            })}
          </div>
          <div className="w-basket-sum">
            <span>Sample total</span>
            <strong>{euros(total)}</strong>
          </div>
          <small>Excl. VAT · Preview prices</small>
          <button className="k-button primary" onClick={() => setCart(true)}>
            Review basket <ArrowRight size={17} />
          </button>
          <div className="w-control-note">
            <CheckCheck size={18} />
            <span>
              You choose what changes.
              <br />
              Suggestions never place an order.
            </span>
          </div>
        </aside>
      </div>
      <footer className="k-basket-bar">
        <div className="k-basket-status">
          <span className="k-basket-icon">
            <ShoppingBasket size={22} />
          </span>
          <div>
            <strong>{draft.lines.length} ingredients in your basket</strong>
            <span>
              {unavailable.length
                ? `${unavailable.length} replacement needed`
                : "Ready for your review"}{" "}
              <span>·</span> {draft.portions} planned portions
            </span>
          </div>
        </div>
        <div className="k-basket-total">
          <div>
            <strong>{euros(total)}</strong>
            <span>Sample total · excl. VAT</span>
          </div>
          <button className="k-button primary" onClick={() => setCart(true)}>
            Review basket <ArrowRight size={18} />
          </button>
        </div>
      </footer>
      {notice && (
        <div className="k-toast" role="status">
          <Check size={17} />
          <span>{notice}</span>
          {previous && <button onClick={undo}>Undo</button>}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {cart && (
        <Cart
          draft={draft}
          close={() => setCart(false)}
          update={update}
          compare={compare}
        />
      )}
      {detail && (
        <ProductDetail
          product={detail}
          close={() => setDetail(undefined)}
          add={() => {
            update(detail.id, qty(detail.id) + 1);
            setDetail(undefined);
          }}
        />
      )}
    </div>
  );
}
