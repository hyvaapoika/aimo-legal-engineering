"use client";
import { InlineAlternative } from "./inline-alternative";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Plus,
  Minus,
  ShoppingBasket,
  X,
} from "lucide-react";
import type { Offer } from "@aimo/schema";
import {
  api,
  labels,
  money,
  packText,
  productName,
  type StoreProduct,
  type SearchResult,
  type Line,
} from "./types";
import { cents, purchaseStep } from "./cart";
import {
  ingredientAmount,
  ingredientQuantity,
  portionsFrom,
  pantryMentions,
  type Recipe,
} from "./recipe-state";

type Props = {
  recipe: Recipe;
  instruction: string;
  claims: string[];
  unresolved: string[];
  date: string;
  saved: Line[][];
  source?: string;
  onBack: () => void;
  onAdd: (lines: Line[]) => boolean;
};
export function RecipeBuilder({
  recipe,
  instruction,
  claims: requestedClaims,
  unresolved,
  date,
  saved,
  source,
  onBack,
  onAdd,
}: Props) {
  const [claims, setClaims] = useState(requestedClaims);
  const requestedClaimKey = requestedClaims.join(",");
  useEffect(() => {
    setClaims((old) => [...new Set([...old, ...requestedClaims])]);
  }, [requestedClaimKey]);
  const [portions, setPortions] = useState(portionsFrom(instruction) || 80);
  const [options, setOptions] = useState<Record<string, StoreProduct[]>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [have, setHave] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      pantryMentions(instruction, recipe).map((id) => [id, true]),
    ),
  );
  const [manual, setManual] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [added, setAdded] = useState(false);
  const [offers, setOffers] = useState<Record<string, Offer>>({});
  const serial = useRef(0);
  const claimKey = claims.join(",");
  useEffect(() => {
    const n = portionsFrom(instruction);
    if (n) {
      setPortions(n);
      setAdded(false);
    }
    const mentioned = pantryMentions(instruction, recipe);
    if (mentioned.length) {
      setHave((old) => ({
        ...old,
        ...Object.fromEntries(mentioned.map((id) => [id, true])),
      }));
      setAdded(false);
    }
  }, [instruction, recipe]);
  useEffect(() => {
    const version = ++serial.current;
    setBusy(true);
    setError("");
    setChosen({});
    setOptions({});
    setManual({});
    setAdded(false);
    const preferred = new Set(saved.flat().map((l) => l.product.id));
    Promise.all(
      recipe.ingredients.map(async (i) => {
        if (i.water) return { key: i.id, products: [] as StoreProduct[] };
        const responses = await Promise.all(
          i.preferredIds.length
            ? i.preferredIds.map((id) =>
                api<SearchResult>("suggest", { query: id, claims, limit: 3 }),
              )
            : [
                api<SearchResult>("suggest", {
                  query: i.query,
                  claims,
                  limit: 6,
                }),
              ],
        );
        const products = responses
          .flatMap((r) => r.products)
          .sort(
            (a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)),
          );
        if (serial.current === version) {
          setOptions((old) => ({ ...old, [i.id]: products }));
          if (i.preferredIds.length && products[0])
            setChosen((old) => ({ ...old, [i.id]: products[0]!.id }));
        }
        return { key: i.id, products };
      }),
    )
      .catch(() => {
        if (serial.current === version)
          setError(
            "Some product matches could not load. Choose another recipe or retry.",
          );
      })
      .finally(() => {
        if (serial.current === version) setBusy(false);
      });
    return () => {
      serial.current++;
    };
  }, [recipe.id, claimKey]);
  const products = Object.values(options).flat();
  const ids = [...new Set(Object.values(chosen))].sort().join(",");
  useEffect(() => {
    if (!date || !ids) {
      setOffers({});
      return;
    }
    let current = true;
    api<{ offers: Offer[] }>("offers", {
      productIds: ids.split(","),
      requestedDate: date,
      includeSubstitutesFor: [],
    })
      .then((r) => {
        if (current)
          setOffers(Object.fromEntries(r.offers.map((o) => [o.productId, o])));
      })
      .catch(() => {
        if (current) setOffers({});
      });
    return () => {
      current = false;
    };
  }, [date, ids]);
  const rows = recipe.ingredients.map((i) => {
    const product = products.find((p) => p.id === chosen[i.id]);
    const amount = ingredientAmount(i, recipe, portions);
    const auto = product ? ingredientQuantity(amount, product) : null;
    const qty = manual[i.id] ?? auto;
    const valid =
      product &&
      qty !== null &&
      Number.isFinite(qty) &&
      qty > 0 &&
      Math.abs(
        qty / purchaseStep(product) - Math.round(qty / purchaseStep(product)),
      ) < 1e-8 &&
      claims.every((c) => product.claims.includes(c));
    return {
      ingredient: i,
      product,
      amount,
      qty,
      auto,
      ready: !!valid && !have[i.id] && !i.water,
    };
  });
  const ready = rows.filter((r) => r.ready);
  const total =
    ready.reduce(
      (s, r) => s + cents(r.qty!, offers[r.product!.id]?.price?.value || 0),
      0,
    ) / 100;
  const priced =
    ready.length > 0 && ready.every((r) => offers[r.product!.id]?.price);
  const needChoice = rows.filter(
    (r) => !r.ready && !have[r.ingredient.id] && !r.ingredient.water,
  ).length;
  const history = new Set(saved.flat().map((l) => l.product.id));
  return (
    <section className="r-builder">
      <div className="r-builder-head">
        <button className="r-back" onClick={onBack}>
          <ArrowLeft size={16} /> Recipes
        </button>
        <a href={recipe.source} target="_blank" rel="noreferrer">
          Valio recipe <ExternalLink size={13} />
        </a>
      </div>
      <div className="r-plan-heading">
        <img src={recipe.image} alt={recipe.title} />
        <div>
          <small>YOUR INGREDIENT LIST</small>
          <h2>{recipe.title}</h2>
          <span>{recipe.method}</span>
        </div>
        <label>
          Portions
          <div className="r-portions">
            <button
              aria-label="Fewer portions"
              onClick={() => {
                setPortions((p) => Math.max(1, p - 10));
                setAdded(false);
              }}
            >
              <Minus size={14} />
            </button>
            <input
              aria-label="Recipe portions"
              type="number"
              min="1"
              max="1000"
              value={portions}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= 1000) {
                  setPortions(n);
                  setAdded(false);
                }
              }}
            />
            <button
              aria-label="More portions"
              onClick={() => {
                setPortions((p) => Math.min(1000, p + 10));
                setAdded(false);
              }}
            >
              <Plus size={14} />
            </button>
          </div>
        </label>
      </div>
      {claims.length > 0 && (
        <div className="r-query-chips">
          {claims.map((c) => (
            <button
              key={c}
              onClick={() => setClaims((old) => old.filter((x) => x !== c))}
            >
              {labels[c] || c}
              <X size={12} />
            </button>
          ))}
        </div>
      )}
      {unresolved.length > 0 && (
        <p className="s-error" role="alert">
          This requirement needs review. {unresolved[0]}
        </p>
      )}
      <div className="r-plan-layout">
        <div className="r-ingredients">
          <div className="r-list-head">
            <span>Ingredient</span>
            <span>For {portions} portions</span>
            <span>Have it</span>
          </div>
          {rows.map(
            ({ ingredient: i, product, amount, qty, auto, ready: isReady }) => (
              <div
                className={`r-ingredient ${have[i.id] ? "is-have" : ""}`}
                key={i.id}
              >
                <div className="r-ingredient-main">
                  <button
                    className="r-ingredient-name"
                    onClick={() => setOpen(open === i.id ? undefined : i.id)}
                    disabled={i.water}
                  >
                    <span>{i.name}</span>
                    <small>
                      {i.water
                        ? "Kitchen water"
                        : product
                          ? `${product.brand || "Selected product"} · ${packText(product)}`
                          : busy
                            ? "Finding products…"
                            : "Choose a product"}
                    </small>
                  </button>
                  <strong>
                    {amount === null
                      ? "To taste"
                      : amount < 1
                        ? `${Number((amount * 1000).toFixed(1))} g`
                        : `${Number(amount.toFixed(3))} kg`}
                  </strong>
                  <label className="r-have">
                    <input
                      type="checkbox"
                      aria-label={`Already have ${i.name}`}
                      checked={!!have[i.id] || i.water}
                      disabled={i.water}
                      onChange={(e) => {
                        setHave((s) => ({ ...s, [i.id]: e.target.checked }));
                        setAdded(false);
                      }}
                    />
                    <Check size={15} />
                  </label>
                </div>
                {product && !have[i.id] && !i.water && (
                  <div className="r-pack-line">
                    <button
                      onClick={() => setOpen(open === i.id ? undefined : i.id)}
                    >
                      {productName(product)}
                      <ChevronDown size={13} />
                    </button>
                    {history.has(product.id) && (
                      <span className="r-history">From a saved basket</span>
                    )}
                    {auto === null ? (
                      <label>
                        Pack quantity{" "}
                        <input
                          aria-label={`Pack quantity for ${i.name}`}
                          type="number"
                          min={purchaseStep(product)}
                          step={purchaseStep(product)}
                          value={manual[i.id] ?? ""}
                          placeholder="Choose"
                          onChange={(e) => {
                            setManual((s) => ({
                              ...s,
                              [i.id]: Number(e.target.value),
                            }));
                            setAdded(false);
                          }}
                        />
                      </label>
                    ) : (
                      <span>
                        {qty}{" "}
                        {product.salesUnit === "ST"
                          ? "pieces"
                          : product.salesUnit === "KI"
                            ? "cases"
                            : product.salesUnit}
                      </span>
                    )}
                    {isReady && offers[product.id]?.price && (
                      <b>
                        {money(
                          cents(qty!, offers[product.id]!.price!.value) / 100,
                        )}
                      </b>
                    )}
                  </div>
                )}
                {product && isReady && qty !== null && qty === auto && (
                  <InlineAlternative
                    line={{ product, qty, requiredClaims: claims }}
                    date={date}
                    currentOffer={offers[product.id]}
                    samplePrices={source !== "valio"}
                    accept={(next, nextQty) =>
                      ingredientQuantity(amount, next) === nextQty
                    }
                    onSelect={(next) => {
                      setOptions((old) => ({
                        ...old,
                        [i.id]: [
                          ...(old[i.id] || []).filter((p) => p.id !== next.id),
                          next,
                        ],
                      }));
                      setChosen((old) => ({ ...old, [i.id]: next.id }));
                      setManual((old) => {
                        const updated = { ...old };
                        delete updated[i.id];
                        return updated;
                      });
                      setAdded(false);
                    }}
                  />
                )}
                {open === i.id && !i.water && (
                  <div className="r-picks">
                    {(options[i.id] || []).length ? (
                      (options[i.id] || []).map((p) => (
                        <button
                          className={chosen[i.id] === p.id ? "chosen" : ""}
                          key={p.id}
                          onClick={() => {
                            setChosen((s) => ({ ...s, [i.id]: p.id }));
                            setManual((s) => {
                              const n = { ...s };
                              delete n[i.id];
                              return n;
                            });
                            setOpen(undefined);
                            setAdded(false);
                          }}
                        >
                          <span>
                            {productName(p)}
                            <small>{packText(p)}</small>
                          </span>
                          {chosen[i.id] === p.id ? (
                            <Check size={16} />
                          ) : (
                            <Plus size={16} />
                          )}
                        </button>
                      ))
                    ) : (
                      <p>
                        {busy
                          ? "Finding products…"
                          : "No verified match for these requirements."}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ),
          )}
          {error && (
            <p role="alert" className="s-error">
              {error}
            </p>
          )}
        </div>
        <aside className="r-plan-summary">
          <ShoppingBasket size={24} />
          <h3>
            {ready.length} {ready.length === 1 ? "item" : "items"} ready
          </h3>
          <p>
            {needChoice
              ? `${needChoice} ingredients still need a choice`
              : "Your selected ingredients are ready."}
          </p>
          <div>
            <span>{priced ? "Selected total" : "Known-price subtotal"}</span>
            <strong>{money(total)}</strong>
          </div>
          <small>Excl. VAT{source !== "valio" ? " · Sample prices" : ""}</small>
          <button
            disabled={!ready.length || added || unresolved.length > 0}
            onClick={() => {
              const accepted = onAdd(
                ready.map((r) => ({
                  product: r.product!,
                  qty: r.qty!,
                  requiredClaims: claims,
                })),
              );
              setAdded(accepted);
            }}
          >
            {added ? (
              <>
                <Check size={17} /> Added to basket
              </>
            ) : (
              <>
                Add {ready.length} selected{" "}
                {ready.length === 1 ? "item" : "items"} <ArrowRight size={16} />
              </>
            )}
          </button>
          <p className="r-note">
            {ready.length < rows.filter((r) => !r.ingredient.water).length
              ? "Only selected items are added. "
              : ""}
            Review product suitability before ordering.
          </p>
        </aside>
      </div>
    </section>
  );
}
