"use client";
import { useDialog } from "./use-dialog";
import { useState, type FormEvent } from "react";
import { X, KeyRound, ArrowDownToLine, ShieldCheck, Check } from "lucide-react";
import type { Mandate } from "@aimo/schema";
import { api, download, type SafeAgent } from "./shared";
export function AgentDrawer({
  agent,
  template,
  categories,
  close,
  refresh,
}: {
  agent: SafeAgent | "new";
  template?: Mandate;
  categories: string[];
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const dialogRef = useDialog(close);
  const isNew = agent === "new";
  const initial = isNew ? template : agent.mandate;
  const [name, setName] = useState(isNew ? "" : agent.name);
  const [mandate, setMandate] = useState<Mandate>(structuredClone(initial!));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<unknown>();
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (isNew) {
        const result = await api<{ credentials: unknown }>("agents", {
          name,
          mandate,
        });
        setCredentials(result.credentials);
      } else {
        await api(`agents/${agent.id}`, { mandate }, "PATCH");
        close();
      }
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        ref={dialogRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Agent mandate"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="drawer-close icon-button"
          aria-label="Close agent settings"
          onClick={close}
        >
          <X size={20} />
        </button>
        <span className="eyebrow">AGENT ACCESS</span>
        <h2 className="display">
          {isNew ? "A new pair of hands." : "Authority, precisely set."}
        </h2>
        {credentials ? (
          <div className="credentials">
            <KeyRound size={30} />
            <h3>Agent registered.</h3>
            <p>
              Download the agent credentials now. The private key is shown only
              at creation.
            </p>
            <button
              className="primary"
              onClick={() =>
                download("aimo-agent-credentials.json", credentials)
              }
            >
              <ArrowDownToLine size={16} /> Download credentials
            </button>
            <button className="secondary" onClick={close}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={save}>
            <label>
              Agent name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isNew}
                required
              />
            </label>
            <div className="form-row">
              <label>
                Per-order limit (€)
                <input
                  type="number"
                  min="0"
                  step=".01"
                  value={mandate.limits.perOrder}
                  onChange={(e) =>
                    setMandate({
                      ...mandate,
                      limits: {
                        ...mandate.limits,
                        perOrder: Number(e.target.value),
                      },
                    })
                  }
                  required
                />
              </label>
              <label>
                Rolling 7-day limit (€)
                <input
                  type="number"
                  min="0"
                  step=".01"
                  value={mandate.limits.perWeek}
                  onChange={(e) =>
                    setMandate({
                      ...mandate,
                      limits: {
                        ...mandate.limits,
                        perWeek: Number(e.target.value),
                      },
                    })
                  }
                  required
                />
              </label>
            </div>
            <label>
              Delivery sites (comma separated)
              <input
                value={mandate.deliverySites.join(", ")}
                onChange={(e) =>
                  setMandate({
                    ...mandate,
                    deliverySites: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                required
              />
            </label>
            <label>
              Substitution permission
              <select
                value={mandate.substitutionPolicy}
                onChange={(e) =>
                  setMandate({
                    ...mandate,
                    substitutionPolicy: e.target
                      .value as Mandate["substitutionPolicy"],
                  })
                }
              >
                <option value="explicit">
                  Supplier-listed substitutes only
                </option>
                <option value="category">
                  Within the same product category
                </option>
                <option value="none">Always ask a human</option>
              </select>
            </label>
            <label>
              Allergen policy
              <select
                value={mandate.allergenProfile}
                onChange={(e) =>
                  setMandate({
                    ...mandate,
                    allergenProfile: e.target
                      .value as Mandate["allergenProfile"],
                  })
                }
              >
                <option value="standard">Enforce declared requirements</option>
                <option value="strict">
                  Also preserve all free-from claims on substitutions
                </option>
              </select>
            </label>
            <label>
              Supplier egg declaration
              <select
                value={mandate.requireEggDeclaration ? "required" : "optional"}
                onChange={(e) =>
                  setMandate({
                    ...mandate,
                    requireEggDeclaration: e.target.value === "required",
                  })
                }
              >
                <option value="optional">
                  Use the standard catalogue checks
                </option>
                <option value="required">
                  Require an egg-free declaration for every product
                </option>
              </select>
            </label>
            <label>
              Required claims (comma separated)
              <input
                value={mandate.requiredClaims.join(",")}
                onChange={(e) =>
                  setMandate({
                    ...mandate,
                    requiredClaims: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="e.g. FREE_FROM_LACTOSE"
              />
            </label>
            <label>
              Allowed categories
              <select
                multiple
                value={mandate.categories}
                onChange={(e) =>
                  setMandate({
                    ...mandate,
                    categories: Array.from(
                      e.target.selectedOptions,
                      (o) => o.value,
                    ),
                  })
                }
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <small>
                Category codes are supplied without category names. Hold ⌘ /
                Ctrl to select several.
              </small>
            </label>
            <div className="approver-row">
              <ShieldCheck size={20} />
              <div>
                <strong>{mandate.approvers[0]?.name}</strong>
                <span>Registered approver · app inbox</span>
              </div>
            </div>
            <details>
              <summary>View machine-readable mandate</summary>
              <pre>{JSON.stringify(mandate, null, 2)}</pre>
            </details>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="drawer-actions">
              <button className="primary" disabled={busy}>
                <Check size={16} /> {isNew ? "Register agent" : "Save mandate"}
              </button>
              {!isNew && (
                <button
                  type="button"
                  className="secondary"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(
                        `agents/${agent.id}`,
                        { active: !agent.active },
                        "PATCH",
                      );
                      await refresh();
                      close();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {agent.active ? "Revoke access" : "Restore access"}
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
