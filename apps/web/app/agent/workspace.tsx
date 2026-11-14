"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  LoaderCircle,
  Mic,
  Paperclip,
  Plus,
  Settings2,
  Square,
  X,
} from "lucide-react";
import type {
  KitchenProfile,
  KitchenIntent,
  PurchasePlan,
  ShopProduct,
  AgentInput,
} from "../../../../packages/purchasing/src/contracts";
import recipes from "../../../../packages/discovery/src/recipes-data.json";
import { step } from "../../../../packages/purchasing/src/quantities";
import {
  api,
  money,
  productName,
  packText,
  labels,
  type SearchResult,
  type Line,
} from "../store/types";
import { ProductMedia } from "../store/media";
import "../store/store.css";
import "../store/live.css";
import "./workspace.css";
type Plan = Omit<PurchasePlan, "offers" | "fingerprint" | "key">;
function Picker({
  onPick,
  placeholder = "Find a product",
}: {
  onPick: (p: ShopProduct) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(""),
    [items, setItems] = useState<ShopProduct[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (query.trim().length < 2) {
        setItems([]);
        return;
      }
      api<SearchResult>("suggest", { query, limit: 5 }, controller.signal)
        .then((r) => setItems(r.products))
        .catch(() => setItems([]));
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return (
    <div className="a-picker">
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {items.length > 0 && (
        <div className="a-picker-results">
          {items.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => {
                onPick(p);
                setQuery("");
                setItems([]);
              }}
            >
              {productName(p)}
              <small>{packText(p)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
const clone = <T,>(x: T): T => structuredClone(x);
export default function KitchenWorkspace() {
  const [profiles, setProfiles] = useState<KitchenProfile[]>([]),
    [profile, setProfile] = useState<KitchenProfile>(),
    [products, setProducts] = useState<Record<string, ShopProduct>>({});
  const [preferences, setPreferences] = useState(false),
    [dirty, setDirty] = useState(false),
    [text, setText] = useState(""),
    [date, setDate] = useState(""),
    [source, setSource] = useState("mock");
  const [plan, setPlan] = useState<Plan>(),
    [draft, setDraft] = useState<KitchenIntent>(),
    [editing, setEditing] = useState(false),
    [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [media, setMedia] = useState<AgentInput["media"]>(),
    [mediaLabel, setMediaLabel] = useState(""),
    [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null),
    recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    capture = useRef<MediaStream | null>(null);
  const inputFile = useRef<HTMLInputElement>(null);
  useEffect(() => {
    Promise.all([
      api<{ profiles: KitchenProfile[]; products: ShopProduct[] }>(
        "kitchen/profiles",
        {},
      ),
      api<{ today: string; source: string }>("context"),
    ])
      .then(([r, c]) => {
        setProfiles(r.profiles);
        setProfile(r.profiles[0]);
        setPreferences(!r.profiles[0]?.revision);
        setProducts(Object.fromEntries(r.products.map((p) => [p.id, p])));
        setSource(c.source);
        const next = new Date(c.today + "T12:00:00Z");
        next.setUTCDate(next.getUTCDate() + 2);
        setDate(next.toISOString().slice(0, 10));
        const last = sessionStorage.getItem("aimo-kitchen-plan");
        if (last)
          api<Plan>("kitchen/status", { id: last })
            .then((p) => {
              setPlan(p);
              setText(p.text);
              setDate(p.date);
              setProfile(r.profiles.find((x) => x.id === p.profileId));
              setPreferences(false);
            })
            .catch(() => sessionStorage.removeItem("aimo-kitchen-plan"));
      })
      .catch((e) => setError(e.message));
    return () => {
      if (recordTimer.current) clearTimeout(recordTimer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      capture.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (plan?.status !== "working") return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      try {
        const next = await api<Plan>("kitchen/status", { id: plan.id });
        if (!active) return;
        setPlan(next);
        failures = 0;
        if (next.status === "working") timer = setTimeout(poll, 1200);
      } catch (e) {
        if (!active) return;
        setError((e as Error).message);
        if (++failures < 4) timer = setTimeout(poll, 2000);
      }
    };
    timer = setTimeout(poll, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [plan?.id, plan?.status]);
  const running = busy || plan?.status === "working";
  const accept = (p: Plan) => {
    setPlan(p);
    sessionStorage.setItem("aimo-kitchen-plan", p.id);
  };
  const updateProfile = (next: KitchenProfile) => {
    setProfile(next);
    setDirty(true);
    setNotice("");
  };
  const save = async () => {
    if (!profile) return;
    setBusy(true);
    setError("");
    try {
      const { customerId: _customer, updatedAt: _time, ...input } = profile;
      const next = await api<KitchenProfile>("kitchen/profile", input);
      setProfile(next);
      setProfiles((old) => old.map((p) => (p.id === next.id ? next : p)));
      setDirty(false);
      setPreferences(false);
      setNotice("Kitchen preferences saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const prepare = async () => {
    if (!profile) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const p = await api<Plan>("kitchen/start", {
        profileId: profile.id,
        text: text.trim() || plan?.text || "",
        date,
        key: crypto.randomUUID(),
        ...(plan?.intent ? { previousId: plan.id } : {}),
        ...(media ? { media } : {}),
      });
      accept(p);
      setEditing(false);
      setMedia(undefined);
      setMediaLabel("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const revise = async (intent: KitchenIntent) => {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      accept(
        await api<Plan>("kitchen/update", {
          id: plan.id,
          revision: plan.revision,
          intent,
        }),
      );
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rowChange = async (
    id: string,
    productId: string | null,
    qty: number | null,
  ) => {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      accept(
        await api<Plan>("kitchen/update", {
          id: plan.id,
          revision: plan.revision,
          row: { id, productId, qty },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const useBasket = async () => {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      const basket = await api<{ date: string; lines: Line[] }>(
        "kitchen/export",
        { id: plan.id, revision: plan.revision },
      );
      sessionStorage.setItem("aimo-prepared-basket", JSON.stringify(basket));
      window.location.assign("/?prepared=1");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const attach = async (blob: Blob, label: string) => {
    if (blob.size > 2_900_000)
      throw new Error("Choose a file under 2.9 MB or a shorter recording.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const mimeType = blob.type.split(";")[0] as NonNullable<
      AgentInput["media"]
    >["mimeType"];
    if (
      ![
        "image/jpeg",
        "image/png",
        "image/webp",
        "audio/webm",
        "audio/mp4",
        "audio/wav",
        "audio/ogg",
      ].includes(mimeType)
    )
      throw new Error("Use a JPEG, PNG, WebP or supported audio file.");
    setMedia({ mimeType, data: btoa(binary) });
    setMediaLabel(label);
  };
  const voice = async () => {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setError("");
    try {
      if (!navigator.mediaDevices || !window.MediaRecorder)
        throw new Error(
          "Voice recording is unavailable in this browser. Type your request instead.",
        );
      capture.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const rec = new MediaRecorder(capture.current, { mimeType });
      recorder.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        if (recordTimer.current) clearTimeout(recordTimer.current);
        capture.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        void attach(new Blob(chunks, { type: mimeType }), "Voice note").catch(
          (e) => setError(e.message),
        );
      };
      rec.start();
      setRecording(true);
      recordTimer.current = setTimeout(() => {
        if (rec.state === "recording") rec.stop();
      }, 30000);
    } catch (e) {
      capture.current?.getTracks().forEach((t) => t.stop());
      setError((e as Error).message);
    }
  };
  const selected = (id: string) =>
    products[id] ? productName(products[id]!) : `Product ${id}`;
  const remember = (p: ShopProduct) =>
    setProducts((old) => ({ ...old, [p.id]: p }));
  const attention = plan?.rows.filter((r) => r.status === "attention") || [];
  const ready = plan?.rows.filter((r) => r.status === "ready") || [];
  const rows = showAll || !attention.length ? plan?.rows || [] : attention;
  return (
    <div className="store a-workspace">
      <header className="a-header">
        <Link href="/" aria-label="Valio Aimo shop">
          <img src="/store/aimo-logo.svg" alt="Valio Aimo" />
        </Link>
        <Link href="/">
          <ArrowLeft size={16} /> Shop
        </Link>
        <span>Your purchasing assistant</span>
      </header>
      <main className="a-main">
        <div className="a-title">
          <div>
            <span className="a-eyebrow">AIMO FOR YOUR KITCHEN</span>
            <h1>From your menu to your next order.</h1>
            <p>
              Tell us what’s changing. We’ll prepare the products and highlight
              the decisions.
            </p>
          </div>
          <button
            className="a-secondary"
            onClick={() => setPreferences(!preferences)}
          >
            <Settings2 size={17} /> Kitchen preferences
          </button>
        </div>
        {error && (
          <div className="a-error" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <p className="a-notice" role="status">
            <Check size={15} />
            {notice}
          </p>
        )}
        <div className="a-context">
          <label>
            Kitchen
            <select
              disabled={running}
              value={profile?.id || "lunch"}
              onChange={(e) => {
                const p = profiles.find((p) => p.id === e.target.value);
                setProfile(p);
                setDirty(false);
                setPlan(undefined);
                setText("");
                setPreferences(!p?.revision);
                sessionStorage.removeItem("aimo-kitchen-plan");
              }}
            >
              <option value="lunch">Lunch kitchen</option>
              <option value="hotel">Hotel breakfast</option>
            </select>
          </label>
          <label>
            Delivery
            <input
              aria-label="Requested delivery"
              type="date"
              value={date}
              disabled={running}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {profile?.revision ? (
            <span>
              <Check size={14} /> Preferences saved · v{profile.revision}
            </span>
          ) : (
            <span>One-time setup: review and save your preferences</span>
          )}
        </div>
        {preferences && profile && (
          <section className="a-profile">
            <h2>{profile.name}</h2>
            {!profile.revision && (
              <p>
                Starter preferences. Review these before saving; they are not
                learned customer history.
              </p>
            )}
            <div className="a-profile-controls">
              <label>
                Kitchen name
                <input
                  value={profile.name}
                  onChange={(e) =>
                    updateProfile({ ...profile, name: e.target.value })
                  }
                />
              </label>
              <label>
                Maximum €/portion
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={profile.budgetPerPortion ?? ""}
                  placeholder="No kitchen limit"
                  onChange={(e) =>
                    updateProfile({
                      ...profile,
                      budgetPerPortion: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                />
              </label>
            </div>
            <div className="a-claims">
              {Object.entries(labels).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={profile.claims.includes(key as never)}
                    onChange={(e) =>
                      updateProfile({
                        ...profile,
                        claims: (e.target.checked
                          ? [...profile.claims, key]
                          : profile.claims.filter(
                              (c) => c !== key,
                            )) as KitchenProfile["claims"],
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="a-preferences">
              {profile.preferences.map((pref, index) => (
                <article key={index}>
                  <div className="a-pref-main">
                    <label>
                      Use for
                      <input
                        value={pref.key}
                        onChange={(e) =>
                          updateProfile({
                            ...profile,
                            preferences: profile.preferences.map((p, i) =>
                              i === index ? { ...p, key: e.target.value } : p,
                            ),
                          })
                        }
                      />
                    </label>
                    <strong>{selected(pref.productId)}</strong>
                    <label>
                      Usual sales packs
                      <input
                        type="number"
                        min="1"
                        value={pref.quantity}
                        onChange={(e) =>
                          updateProfile({
                            ...profile,
                            preferences: profile.preferences.map((p, i) =>
                              i === index
                                ? { ...p, quantity: Number(e.target.value) }
                                : p,
                            ),
                          })
                        }
                      />
                    </label>
                    <select
                      aria-label={`Replacement rule for ${pref.key}`}
                      value={pref.mode}
                      onChange={(e) =>
                        updateProfile({
                          ...profile,
                          preferences: profile.preferences.map((p, i) =>
                            i === index
                              ? {
                                  ...p,
                                  mode: e.target.value as "exact" | "approved",
                                }
                              : p,
                          ),
                        })
                      }
                    >
                      <option value="exact">Exact product only</option>
                      <option value="approved">
                        Allow approved alternatives
                      </option>
                    </select>
                    <button
                      className="a-icon"
                      aria-label={`Remove preference ${pref.key}`}
                      onClick={() =>
                        updateProfile({
                          ...profile,
                          preferences: profile.preferences.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {pref.mode === "approved" && (
                    <div className="a-approved">
                      <span>Approved alternatives</span>
                      {pref.alternatives.map((id) => (
                        <button
                          key={id}
                          onClick={() =>
                            updateProfile({
                              ...profile,
                              preferences: profile.preferences.map((p, i) =>
                                i === index
                                  ? {
                                      ...p,
                                      alternatives: p.alternatives.filter(
                                        (x) => x !== id,
                                      ),
                                    }
                                  : p,
                              ),
                            })
                          }
                        >
                          {selected(id)} <X size={12} />
                        </button>
                      ))}
                      <Picker
                        placeholder={`Add approved alternative for ${pref.key}`}
                        onPick={(p) => {
                          remember(p);
                          updateProfile({
                            ...profile,
                            preferences: profile.preferences.map((x, i) =>
                              i === index
                                ? {
                                    ...x,
                                    alternatives: [
                                      ...new Set([...x.alternatives, p.id]),
                                    ],
                                  }
                                : x,
                            ),
                          });
                        }}
                      />
                    </div>
                  )}
                </article>
              ))}
            </div>
            <Picker
              placeholder="Add a preferred product"
              onPick={(p) => {
                remember(p);
                updateProfile({
                  ...profile,
                  preferences: [
                    ...profile.preferences,
                    {
                      key: productName(p),
                      productId: p.id,
                      quantity: step(p),
                      mode: "exact",
                      alternatives: [],
                    },
                  ],
                });
              }}
            />
            <button
              className="a-primary"
              disabled={running || (!dirty && profile.revision > 0)}
              onClick={save}
            >
              Save kitchen preferences <Check size={16} />
            </button>
          </section>
        )}
        <section className="a-request">
          <label htmlFor="agent-request">
            What do you need for the kitchen?
          </label>
          <textarea
            id="agent-request"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              profile?.id === "hotel"
                ? "Prepare our usual breakfast order. Use our approved alternatives if needed."
                : "Tomato & basil pasta for 80 people. I already have 5 kg of fresh pasta."
            }
          />
          <div className="a-request-actions">
            <div>
              <input
                ref={inputFile}
                type="file"
                accept="image/jpeg,image/png,image/webp,audio/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void attach(file, file.name).catch((e) =>
                      setError(e.message),
                    );
                  e.target.value = "";
                }}
              />
              <button
                disabled={running || recording}
                onClick={() => inputFile.current?.click()}
              >
                <Paperclip size={17} /> Menu photo
              </button>
              <button disabled={running} onClick={voice}>
                {recording ? <Square size={15} /> : <Mic size={17} />}{" "}
                {recording ? "Stop recording" : "Speak"}
              </button>
              {media && (
                <span className="a-attachment">
                  {mediaLabel}
                  <button
                    aria-label="Remove attachment"
                    onClick={() => {
                      setMedia(undefined);
                      setMediaLabel("");
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
            </div>
            <button
              className="a-primary"
              disabled={
                running ||
                recording ||
                !profile?.revision ||
                dirty ||
                (!text.trim() && !media && !plan) ||
                !date
              }
              onClick={prepare}
            >
              {running ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <ArrowRight size={17} />
              )}{" "}
              Prepare my basket
            </button>
          </div>
          <div className="a-request-hints">
            <button
              disabled={running}
              onClick={() =>
                setText(
                  profile?.id === "hotel"
                    ? "Prepare our usual breakfast order, checking approved alternatives for unavailable products."
                    : "Tomato and basil pasta for 80 people. I already have 5 kg of fresh pasta.",
                )
              }
            >
              {profile?.id === "hotel"
                ? "Check the usual breakfast order"
                : "Lunch for 80, using pantry stock"}
            </button>
            {media && (
              <small>
                Sent to Gemini when you prepare. Attachments are not stored with
                the plan.
              </small>
            )}
          </div>
        </section>
        {plan && (
          <>
            <section className="a-progress" aria-label="Agent progress">
              {plan.events.map((event, index) => (
                <div key={`${event.tool}-${index}`} className={event.state}>
                  {event.state === "done" ? (
                    <Check size={16} />
                  ) : (
                    <LoaderCircle className="spin" size={16} />
                  )}
                  <span>{event.label}</span>
                </div>
              ))}
              {plan.status === "failed" && <p role="alert">{plan.error}</p>}
            </section>
            {plan.status === "ready" && plan.intent && (
              <section className="a-review">
                <div className="a-review-title">
                  <div>
                    <span className="a-eyebrow">
                      YOUR PREPARED BASKET · REVISION {plan.revision}
                    </span>
                    <h2>
                      {attention.length + plan.issues.length
                        ? `${attention.length + plan.issues.length} decisions need your attention`
                        : "Your basket is ready to review"}
                    </h2>
                    <p>
                      {ready.length} ingredients ready ·{" "}
                      {plan.rows.filter((r) => r.status === "covered").length}{" "}
                      covered by your pantry
                      {plan.interpretation === "local"
                        ? " · Local interpretation"
                        : ""}
                    </p>
                  </div>
                  <button
                    className="a-secondary"
                    disabled={busy}
                    onClick={() => {
                      setDraft(clone(plan.intent!));
                      setEditing(!editing);
                    }}
                  >
                    Edit menu & quantities <ChevronDown size={15} />
                  </button>
                </div>
                {editing && draft && (
                  <section className="a-menu-editor">
                    <h3>What Aimo understood</h3>
                    <p>{draft.summary}</p>
                    {draft.dishes.map((dish, index) => (
                      <div className="a-edit-line" key={index}>
                        <select
                          aria-label={`Recipe ${index + 1}`}
                          value={dish.recipeId ?? ""}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              dishes: draft.dishes.map((d, i) =>
                                i === index
                                  ? {
                                      ...d,
                                      recipeId: e.target.value || null,
                                      name:
                                        recipes.find(
                                          (r) => r.id === e.target.value,
                                        )?.title || d.name,
                                    }
                                  : d,
                              ),
                            })
                          }
                        >
                          <option value="">
                            Choose a sourced recipe for {dish.name}
                          </option>
                          {recipes.map((r) => (
                            <option value={r.id} key={r.id}>
                              {r.title}
                            </option>
                          ))}
                        </select>
                        <label>
                          Portions
                          <input
                            aria-label={`Portions for ${dish.name}`}
                            type="number"
                            min="1"
                            max="1000"
                            value={dish.portions}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                dishes: draft.dishes.map((d, i) =>
                                  i === index
                                    ? { ...d, portions: Number(e.target.value) }
                                    : d,
                                ),
                              })
                            }
                          />
                        </label>
                        <button
                          aria-label={`Remove ${dish.name}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              dishes: draft.dishes.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          <X size={15} />
                        </button>
                        <div className="a-claims">
                          {Object.entries(labels).map(([key, label]) => (
                            <label key={key}>
                              <input
                                type="checkbox"
                                checked={dish.claims.includes(key as never)}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    dishes: draft.dishes.map((d, i) =>
                                      i === index
                                        ? {
                                            ...d,
                                            claims: (e.target.checked
                                              ? [...d.claims, key]
                                              : d.claims.filter(
                                                  (c) => c !== key,
                                                )) as typeof d.claims,
                                          }
                                        : d,
                                    ),
                                  })
                                }
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                    <button
                      className="a-secondary"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          dishes: [
                            ...draft.dishes,
                            {
                              recipeId: recipes[0]!.id,
                              name: recipes[0]!.title,
                              portions: 80,
                              claims: [],
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={15} /> Add a dish
                    </button>
                    {draft.items.map((item, index) => (
                      <div className="a-edit-line" key={index}>
                        <input
                          aria-label={`Product request ${index + 1}`}
                          value={item.query}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              items: draft.items.map((x, i) =>
                                i === index
                                  ? { ...x, query: e.target.value }
                                  : x,
                              ),
                            })
                          }
                        />
                        <input
                          aria-label={`Requested quantity for ${item.query}`}
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={item.quantity ?? ""}
                          placeholder="Quantity"
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              items: draft.items.map((x, i) =>
                                i === index
                                  ? {
                                      ...x,
                                      quantity: e.target.value
                                        ? Number(e.target.value)
                                        : null,
                                    }
                                  : x,
                              ),
                            })
                          }
                        />
                        <select
                          aria-label={`Unit for ${item.query}`}
                          value={item.unit ?? ""}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              items: draft.items.map((x, i) =>
                                i === index
                                  ? {
                                      ...x,
                                      unit: e.target.value as
                                        "sales" | "KG" | "L",
                                    }
                                  : x,
                              ),
                            })
                          }
                        >
                          <option value="">Confirm unit</option>
                          <option value="sales">Sales packs</option>
                          <option value="KG">kg</option>
                          <option value="L">litres</option>
                        </select>
                        <button
                          aria-label={`Remove request ${item.query}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              items: draft.items.filter((_, i) => i !== index),
                            })
                          }
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                    <button
                      className="a-secondary"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          items: [
                            ...draft.items,
                            { query: "", quantity: null, unit: null },
                          ],
                        })
                      }
                    >
                      <Plus size={15} /> Add a product request
                    </button>
                    <h3>Already in the kitchen</h3>
                    {draft.pantry.map((p, index) => (
                      <div className="a-edit-line" key={index}>
                        <input
                          aria-label={`Pantry ingredient ${index + 1}`}
                          value={p.ingredient}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              pantry: draft.pantry.map((x, i) =>
                                i === index
                                  ? { ...x, ingredient: e.target.value }
                                  : x,
                              ),
                            })
                          }
                        />
                        <label>
                          Confirmed kg
                          <input
                            aria-label={`Pantry kg for ${p.ingredient}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={p.amountKg ?? ""}
                            placeholder="How much?"
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                pantry: draft.pantry.map((x, i) =>
                                  i === index
                                    ? {
                                        ...x,
                                        amountKg: e.target.value
                                          ? Number(e.target.value)
                                          : null,
                                      }
                                    : x,
                                ),
                              })
                            }
                          />
                        </label>
                        <button
                          aria-label={`Remove pantry ${p.ingredient}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              pantry: draft.pantry.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                    <button
                      className="a-secondary"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          pantry: [
                            ...draft.pantry,
                            { ingredient: "", amountKg: null },
                          ],
                        })
                      }
                    >
                      <Plus size={15} /> Add pantry stock
                    </button>
                    <h3>Order requirements</h3>
                    <div className="a-claims">
                      {Object.entries(labels).map(([key, label]) => (
                        <label key={key}>
                          <input
                            type="checkbox"
                            checked={draft.claims.includes(key as never)}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                claims: (e.target.checked
                                  ? [...draft.claims, key]
                                  : draft.claims.filter(
                                      (c) => c !== key,
                                    )) as typeof draft.claims,
                              })
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <label>
                      Requested €/portion limit
                      <input
                        aria-label="Requested budget per portion"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={draft.budgetPerPortion ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            budgetPerPortion: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                      />
                    </label>
                    {draft.unresolved.map((note, index) => (
                      <div className="a-unresolved" key={index}>
                        <span>{note}</span>
                        <button
                          onClick={() =>
                            setDraft({
                              ...draft,
                              unresolved: draft.unresolved.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          Remove after reviewing
                        </button>
                      </div>
                    ))}
                    <button
                      className="a-primary"
                      disabled={busy}
                      onClick={() => revise(draft)}
                    >
                      Recalculate this menu <ArrowRight size={16} />
                    </button>
                    <small>
                      Recipe quantities come from the linked Valio recipes.
                      Unknown conversions need your choice.
                    </small>
                  </section>
                )}
                {plan.issues.map((issue, i) => (
                  <p className="a-attention" key={i}>
                    {issue}
                  </p>
                ))}
                {plan.budgetExceeded && (
                  <p className="a-attention">
                    This basket exceeds the per-portion limit. Revise the menu,
                    products or kitchen preference before proceeding.
                  </p>
                )}
                {date !== plan.date && (
                  <p className="a-attention">
                    Delivery date changed. Prepare the request again to check
                    that date.
                  </p>
                )}
                {profile && profile.revision !== plan.profileRevision && (
                  <p className="a-attention">
                    Kitchen preferences changed. Edit the menu and recalculate
                    to apply them.
                  </p>
                )}
                <div className="a-review-layout">
                  <div>
                    <div className="a-list-toggle">
                      <button
                        className={!showAll ? "active" : ""}
                        onClick={() => setShowAll(false)}
                      >
                        Needs attention {attention.length}
                      </button>
                      <button
                        className={showAll ? "active" : ""}
                        onClick={() => setShowAll(true)}
                      >
                        All ingredients {plan.rows.length}
                      </button>
                    </div>
                    <div className="a-plan-rows">
                      {rows.map((row) => {
                        const selected = row.candidates.find(
                          (c) => c.product.id === row.selectedId,
                        );
                        const swapped =
                          row.preferredId &&
                          row.selectedId &&
                          row.preferredId !== row.selectedId;
                        return (
                          <article
                            key={row.id}
                            className={`a-plan-row ${row.status}`}
                          >
                            <div className="a-row-heading">
                              <div>
                                <h3>{row.ingredient}</h3>
                                <small>
                                  {row.required === null
                                    ? "Quantity needs your choice"
                                    : `${Number(row.required.toFixed(3))} ${row.unit === "sales" ? "sales packs" : row.unit.toLowerCase()} needed`}
                                  {row.pantryUsed > 0
                                    ? ` · ${row.pantryUsed} kg from your pantry`
                                    : ""}
                                  {row.exact ? " · Exact product only" : ""}
                                </small>
                              </div>
                              {row.status === "covered" ? (
                                <span className="a-covered">
                                  <Check size={16} /> Already covered
                                </span>
                              ) : (
                                <strong>
                                  {selected?.totalCents !== null &&
                                  selected?.totalCents !== undefined
                                    ? money(selected.totalCents / 100)
                                    : "—"}
                                </strong>
                              )}
                            </div>
                            {row.status !== "covered" && (
                              <>
                                <div className="a-row-product">
                                  {selected && (
                                    <ProductMedia product={selected.product} />
                                  )}
                                  <div>
                                    <select
                                      aria-label={`Product for ${row.ingredient}`}
                                      disabled={busy || !row.candidates.length}
                                      value={row.selectedId ?? ""}
                                      onChange={(e) =>
                                        rowChange(
                                          row.id,
                                          e.target.value || null,
                                          null,
                                        )
                                      }
                                    >
                                      <option value="">Choose a product</option>
                                      {row.candidates.map((c) => (
                                        <option
                                          key={c.product.id}
                                          value={c.product.id}
                                        >
                                          {productName(c.product)}
                                          {c.issue ? ` — ${c.issue}` : ""}
                                        </option>
                                      ))}
                                    </select>
                                    {selected && (
                                      <small>
                                        {packText(selected.product)} ·{" "}
                                        {swapped
                                          ? "Approved kitchen alternative"
                                          : selected.reason}
                                      </small>
                                    )}
                                    {swapped && (
                                      <span className="a-swap-note">
                                        {row.candidates.find(
                                          (c) =>
                                            c.product.id === row.preferredId,
                                        )?.issue ||
                                          "Preferred product replaced"}
                                        . Approved kitchen alternative; review
                                        before using the basket.
                                      </span>
                                    )}
                                  </div>
                                  <label>
                                    Sales packs
                                    <input
                                      key={`${plan.revision}-${row.id}`}
                                      aria-label={`Sales packs for ${row.ingredient}`}
                                      type="number"
                                      min={
                                        selected ? step(selected.product) : 1
                                      }
                                      step={
                                        selected ? step(selected.product) : 1
                                      }
                                      defaultValue={selected?.qty ?? ""}
                                      disabled={busy || !selected}
                                      placeholder="Choose"
                                      onBlur={(e) => {
                                        const value = e.target.value
                                          ? Number(e.target.value)
                                          : null;
                                        if (value !== selected?.qty)
                                          void rowChange(
                                            row.id,
                                            row.selectedId,
                                            value,
                                          );
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          e.currentTarget.blur();
                                      }}
                                    />
                                  </label>
                                </div>
                                {row.issue && (
                                  <p className="a-row-issue">
                                    {row.issue}
                                    {row.pantryUnknown
                                      ? " in Edit menu & quantities."
                                      : ""}
                                  </p>
                                )}
                                {row.manualQty !== null && (
                                  <small className="a-manual">
                                    Manual pack quantity · review coverage
                                  </small>
                                )}
                              </>
                            )}
                            {row.source && (
                              <a
                                className="a-source"
                                href={row.source}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Source recipe: {row.recipe}
                              </a>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                  <aside className="a-total">
                    <span>
                      {attention.length
                        ? "Known-price subtotal"
                        : "Prepared basket total"}
                    </span>
                    <strong>{money(plan.totalCents / 100)}</strong>
                    {plan.costPerPortion !== null && (
                      <p>
                        {money(plan.costPerPortion)} / portion
                        {attention.length ? " so far" : ""}
                      </p>
                    )}
                    <small>
                      Excl. VAT{source !== "valio" ? " · Sample prices" : ""}
                    </small>
                    <div>
                      {ready.length} ingredients ready
                      <br />
                      {attention.length} need a decision
                    </div>
                    <button
                      className="a-primary"
                      disabled={
                        busy ||
                        attention.length > 0 ||
                        plan.issues.length > 0 ||
                        plan.budgetExceeded ||
                        !ready.length ||
                        profile?.revision !== plan.profileRevision ||
                        date !== plan.date
                      }
                      onClick={useBasket}
                    >
                      Use this basket <ArrowRight size={16} />
                    </button>
                    <p className="a-small">
                      Replaces your current basket. Undo is available.
                      Purchasing still requires human approval.
                    </p>
                    <button
                      className="a-secondary"
                      disabled={busy}
                      onClick={() => {
                        setDraft(clone(plan.intent!));
                        setEditing(true);
                      }}
                    >
                      Adjust menu or pantry
                    </button>
                  </aside>
                </div>
              </section>
            )}
          </>
        )}
        {!plan && (
          <div className="a-empty-guide">
            <div>
              <span>01</span>
              <h3>Tell us the plan</h3>
              <p>Use a menu, a voice note or your usual order.</p>
            </div>
            <div>
              <span>02</span>
              <h3>We do the preparation</h3>
              <p>Recipes, packs, preferred products and availability.</p>
            </div>
            <div>
              <span>03</span>
              <h3>Review the decisions</h3>
              <p>See what changed, then use the prepared basket.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
