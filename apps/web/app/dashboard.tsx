"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Code2,
  Fingerprint,
  FlaskConical,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import type { Order, Product } from "@aimo/schema";
import {
  money,
  count,
  day,
  time,
  short,
  api,
  download,
  type Snapshot,
  type SafeAgent,
  type View,
} from "./components/shared";
import { Badge, Empty, Timeline, PageHeading } from "./components/primitives";
import { ApprovalCard } from "./components/approval-card";
import { AgentDrawer } from "./components/agent-drawer";
import { CatalogView } from "./components/catalog-view";
import { DiscoveryContent } from "./components/discovery-content";
import { PurchaseFlow } from "./components/purchase-flow";
const nav: { id: View; name: string; icon: typeof ShieldCheck }[] = [
  { id: "overview", name: "Overview", icon: LayoutDashboard },
  { id: "approvals", name: "Approval inbox", icon: ClipboardList },
  { id: "agents", name: "Agents & mandates", icon: Fingerprint },
  { id: "orders", name: "Orders", icon: PackageCheck },
  { id: "activity", name: "Activity ledger", icon: History },
  { id: "catalog", name: "Product catalog", icon: Search },
  { id: "discovery", name: "Developer access", icon: Code2 },
];
export default function Dashboard({
  demo,
  publicDemo = false,
}: {
  demo: boolean;
  publicDemo?: boolean;
}) {
  const [runSignal, setRunSignal] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [auth, setAuth] = useState(false);
  const [token, setToken] = useState("");
  const [view, setView] = useState<View>("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editingAgent, setEditingAgent] = useState<SafeAgent | "new">();
  const [selectedOrder, setSelectedOrder] = useState<Order>();
  const [verified, setVerified] = useState<string>();
  const [products, setProducts] = useState<Record<string, Product>>({});
  const refresh = useCallback(async () => {
    try {
      const data = await api<Snapshot>("snapshot");
      setSnapshot(data);
      setError((previous) =>
        previous.startsWith("Gateway unavailable.") ? "" : previous,
      );
      setAuth(true);
    } catch (e) {
      if ((e as { status?: number }).status === 401) setAuth(false);
      else setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!snapshot) return;
    const ids = [
      ...new Set(
        snapshot.proposals.flatMap((p) => p.lines.map((l) => l.productId)),
      ),
    ].filter((id) => !products[id]);
    if (!ids.length) return;
    let active = true;
    void Promise.all(ids.map((id) => api<Product>(`catalog/${id}`)))
      .then((rows) => {
        if (active)
          setProducts((previous) => ({
            ...previous,
            ...Object.fromEntries(rows.map((p) => [p.id, p])),
          }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [snapshot, products]);
  const act = async (operation: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pending =
    snapshot?.approvals.filter((a) => a.status === "pending") ?? [];
  const held = pending
    .map((a) => ({
      approval: a,
      proposal: snapshot!.proposals.find((p) => p.id === a.proposalId)!,
    }))
    .filter((x) => x.proposal);
  const spent =
    snapshot?.orders.reduce((sum, order) => sum + order.totalCents, 0) ?? 0;
  const refused =
    snapshot?.proposals.filter((p) => p.status === "refused").length ?? 0;
  const go = (id: View) => {
    setView(id);
    setMenu(false);
    setSelectedOrder(undefined);
  };
  const runDemo = () => {
    setView("overview");
    setRunSignal((n) => n + 1);
  };

  if (!auth)
    return (
      <main className="login">
        <div className="brand login-brand">
          aimo<span>AGENT GATEWAY</span>
        </div>
        <div className="login-panel">
          <span className="eyebrow">PURCHASING WORKSPACE</span>
          <h1>
            Good decisions.
            <br />
            Clear authority.
          </h1>
          <p>
            {publicDemo
              ? "Shared public sandbox. Every order is simulated, and changes are visible to other visitors. Do not enter confidential information."
              : "Sign in to manage your purchasing agents, review exceptions, and follow every order."}
          </p>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void act(async () => {
                await api("session", { token });
                setAuth(true);
              });
            }}
          >
            <label>
              Workspace access token
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
            <button className="primary wide" disabled={busy}>
              Open workspace <ArrowRight size={16} />
            </button>
          </form>
          {demo && (
            <button
              className="text-button demo-login"
              onClick={() =>
                void act(async () => {
                  await api("session", {
                    token: publicDemo ? "public-demo" : "local-admin-demo",
                  });
                  setAuth(true);
                })
              }
            >
              <FlaskConical size={15} />
              {publicDemo
                ? "Enter public sandbox"
                : "Enter local demo workspace"}
            </button>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="login-foot">
            JUNCTION 2026 <span>VALIO AIMO</span>
          </div>
        </div>
      </main>
    );
  return (
    <div className={`shell ${view === "activity" ? "operator" : ""}`}>
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <button className="brand" onClick={() => go("overview")}>
          aimo<span>AGENT GATEWAY</span>
        </button>
        <div className="workspace">
          <span className="workspace-avatar">HH</span>
          <div>
            Hotel Haven<span>Purchasing workspace</span>
          </div>
          <ChevronRight size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "selected" : ""}`}
              onClick={() => go(item.id)}
            >
              <item.icon size={18} strokeWidth={1.6} />
              {item.name}
              {item.id === "approvals" && pending.length > 0 && (
                <span className="nav-count">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="system-state">
            <span className="online-dot" />{" "}
            {snapshot?.mode === "mock" ? "Mock environment" : "Live Valio data"}
            <span>Order placement is simulated</span>
          </div>
          <button
            className="profile"
            onClick={() =>
              void act(async () => {
                await fetch("/api/session", { method: "DELETE" });
                setAuth(false);
                setSnapshot(undefined);
              })
            }
          >
            <span className="profile-avatar">MK</span>
            <span>
              Maija Korhonen<small>Purchasing manager</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={20} />
            </button>
            <span className="muted">Workspace</span>
            <ChevronRight size={14} />
            <span>{nav.find((n) => n.id === view)?.name}</span>
          </div>
          <div>
            <span className="top-date">{day(new Date().toISOString())}</span>
            <a
              className="icon-button"
              href="/discovery"
              aria-label="Gateway documentation"
            >
              <CircleHelp size={18} />
            </a>
          </div>
        </header>
        <main className="content">
          {error && (
            <div role="alert" className="banner error">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="banner success">
              <Check size={16} />
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">PURCHASING CONTROL</span>
                  <h1>Purchasing, with you in control.</h1>
                  <p>
                    Review quotations, talk to Aimo, and approve the next order.
                  </p>
                </div>
                {demo && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void runDemo()}
                  >
                    <FlaskConical size={16} /> Run purchase demo
                  </button>
                )}
              </div>
              {demo && (
                <PurchaseFlow
                  snapshot={snapshot}
                  products={products}
                  refresh={refresh}
                  runSignal={runSignal}
                />
              )}
              <div className="stats-strip">
                <div>
                  <span>Awaiting your decision</span>
                  <strong className="amber">
                    {String(pending.length).padStart(2, "0")}
                  </strong>
                  <small>Quotations held for human review</small>
                </div>
                <div>
                  <span>Orders placed</span>
                  <strong>
                    {String(snapshot?.orders.length ?? 0).padStart(2, "0")}
                  </strong>
                  <small>Fixed prices · fully traced</small>
                </div>
                <div>
                  <span>Committed spend</span>
                  <strong>{money(spent)}</strong>
                  <small>Excluding VAT · this workspace</small>
                </div>
                <div>
                  <span>Guardrails working</span>
                  <strong>{String(refused).padStart(2, "0")}</strong>
                  <small>Unsafe proposals refused</small>
                </div>
              </div>
              <div className="section-heading">
                <h2>
                  Awaiting approval{" "}
                  <span className="tiny-count">{pending.length}</span>
                </h2>
                <button className="text-button" onClick={() => go("approvals")}>
                  Open inbox <ArrowUpRight size={16} />
                </button>
              </div>
              {held.length ? (
                held
                  .slice(0, 2)
                  .map(({ proposal, approval }) => (
                    <ApprovalCard
                      key={approval.id}
                      proposal={proposal}
                      approval={approval}
                      products={products}
                      busy={busy}
                      act={act}
                    />
                  ))
              ) : (
                <Empty
                  action={
                    demo ? (
                      <button
                        className="secondary"
                        onClick={() => void runDemo()}
                        disabled={busy}
                      >
                        Start a purchase <ArrowRight size={16} />
                      </button>
                    ) : undefined
                  }
                >
                  No quotations are waiting for approval.
                </Empty>
              )}
              <div className="lower-columns">
                <section>
                  <div className="section-heading">
                    <h2>Agent authority</h2>
                    <button
                      className="text-button"
                      onClick={() => go("agents")}
                    >
                      Manage <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {snapshot?.agents.map((agent) => (
                    <div className="agent-summary" key={agent.id}>
                      <Fingerprint size={24} strokeWidth={1.3} />
                      <div>
                        <strong>{agent.name}</strong>
                        <span>
                          {agent.mandate.substitutionPolicy} substitutions ·{" "}
                          {agent.mandate.deliverySites.length} delivery site
                        </span>
                      </div>
                      <div className="agent-limit">
                        <strong>
                          {money(agent.mandate.limits.perOrder * 100)}
                        </strong>
                        <span>per order</span>
                      </div>
                    </div>
                  ))}
                  <div className="assurance">
                    <ShieldCheck size={19} />
                    <p>
                      Every order traces back to a signed offer, a policy
                      decision, and the authority that allowed it.
                    </p>
                  </div>
                </section>
                <section>
                  <div className="section-heading">
                    <h2>Latest activity</h2>
                    <button
                      className="text-button"
                      onClick={() => go("activity")}
                    >
                      View ledger <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <Timeline events={snapshot?.events ?? []} compact />
                </section>
              </div>
            </>
          )}
          {view === "approvals" && (
            <>
              <PageHeading
                eyebrow="HUMAN IN THE LOOP"
                title="A decision, not a guess."
                description="Review exceptions against your mandate. Prices and product facts stay fixed."
              />
              <div className="list-toolbar">
                <span>{pending.length} pending decisions</span>
                <span className="muted">Inbox updates automatically</span>
              </div>
              {held.length ? (
                held.map(({ proposal, approval }) => (
                  <ApprovalCard
                    key={approval.id}
                    proposal={proposal}
                    approval={approval}
                    products={products}
                    busy={busy}
                    act={act}
                  />
                ))
              ) : (
                <Empty>All caught up. No proposals need your approval.</Empty>
              )}
            </>
          )}
          {view === "agents" && (
            <>
              <PageHeading
                eyebrow="DELEGATED AUTHORITY"
                title="Set the boundaries."
                description="Give each agent exactly the purchasing authority it needs."
                action={
                  <button
                    className="primary"
                    onClick={() => setEditingAgent("new")}
                  >
                    <Plus size={16} /> Add agent
                  </button>
                }
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Status</th>
                      <th>Per order</th>
                      <th>Rolling week</th>
                      <th>Mandate</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot?.agents.map((agent) => (
                      <tr key={agent.id}>
                        <td>
                          <strong>{agent.name}</strong>
                          <small className="mono muted">
                            {short(agent.id)} · Ed25519
                          </small>
                        </td>
                        <td>
                          <Badge status={agent.active ? "active" : "revoked"} />
                        </td>
                        <td className="mono">
                          {money(agent.mandate.limits.perOrder * 100)}
                        </td>
                        <td className="mono">
                          {money(agent.mandate.limits.perWeek * 100)}
                        </td>
                        <td>
                          {agent.mandate.substitutionPolicy} substitutions
                          <small>
                            {agent.mandate.categories.length} categories · v
                            {agent.mandate.version}
                          </small>
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => setEditingAgent(agent)}
                          >
                            Manage <ArrowUpRight size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="note-panel">
                <ShieldCheck size={22} />
                <div>
                  <h3>Permission lives here.</h3>
                  <p>
                    Models may propose a purchase. The gateway checks identity,
                    product constraints, spending limits, and delivery
                    feasibility before an order can exist.
                  </p>
                </div>
              </div>
            </>
          )}
          {view === "orders" && (
            <>
              <PageHeading
                eyebrow="FIXED PRICES. FULL PROVENANCE."
                title="Orders, accounted for."
                description="Every confirmed order has an offer, a verdict, and a clear trail."
              />
              {snapshot?.orders.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Placed</th>
                        <th>Delivery</th>
                        <th>Lines</th>
                        <th className="number">Total excl. VAT</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.orders
                        .slice()
                        .sort((a, b) =>
                          b.confirmedAt.localeCompare(a.confirmedAt),
                        )
                        .map((order) => (
                          <tr key={order.id}>
                            <td>
                              <button
                                className="link mono"
                                onClick={() => setSelectedOrder(order)}
                              >
                                {order.id}
                              </button>
                              <small>
                                {order.approvalId
                                  ? "Human approved"
                                  : "Within mandate"}
                              </small>
                            </td>
                            <td>
                              {day(order.confirmedAt)}
                              <small>{time(order.confirmedAt)}</small>
                            </td>
                            <td>
                              {day(order.deliveryDate)}
                              <small>{order.deliverySite}</small>
                            </td>
                            <td className="mono">{order.lines.length}</td>
                            <td className="number mono">
                              {money(order.totalCents)}
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={`Open ${order.id}`}
                                onClick={() => setSelectedOrder(order)}
                              >
                                <ArrowUpRight size={17} />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>
                  No orders yet. Run a purchasing scenario to see the full
                  trail.
                </Empty>
              )}
            </>
          )}
          {view === "activity" && (
            <>
              <PageHeading
                eyebrow="AIMO OPERATIONS / AUDIT LEDGER"
                title="Nothing happens off record."
                description="Hash-linked events, from the first request to the final decision."
                action={
                  <button
                    className="secondary"
                    onClick={() =>
                      void act(async () => {
                        const result = await api<{
                          valid: boolean;
                          count: number;
                        }>("ledger/verify");
                        setVerified(
                          result.valid
                            ? `Chain verified · ${result.count} events intact`
                            : "Verification failed — inspect the ledger",
                        );
                      })
                    }
                  >
                    <ShieldCheck size={16} /> Verify chain
                  </button>
                }
              />
              {verified && (
                <div className="verification">
                  <CheckCheck size={18} />
                  {verified}
                </div>
              )}
              <div className="ledger-tools">
                <span className="mono">
                  {snapshot?.events.length ?? 0} EVENTS
                </span>
                <button
                  className="text-button"
                  onClick={() => download("aimo-ledger.json", snapshot?.events)}
                >
                  Export JSON <ArrowDownToLine size={15} />
                </button>
              </div>
              <Timeline
                events={
                  snapshot?.events.filter(
                    (e) =>
                      !e.type.endsWith(".read") &&
                      e.type !== "request.received",
                  ) ?? []
                }
              />
            </>
          )}
          {view === "catalog" && (
            <CatalogView count={snapshot?.catalogCount ?? 0} />
          )}
          {view === "discovery" && (
            <>
              <PageHeading
                eyebrow="AN OPEN DOOR FOR PURCHASING AGENTS"
                title="Bring your own agent."
                description="The same five tools. The same rules. Whatever model you use."
              />
              <DiscoveryContent />
              <a
                className="secondary inline-button"
                href="/discovery"
                target="_blank"
              >
                Public discovery page <ArrowUpRight size={16} />
              </a>
            </>
          )}
          <footer>
            <span>
              VALIO AIMO <span className="separator">/</span> AGENT GATEWAY
            </span>
            <span>
              Junction 2026 ·{" "}
              {snapshot?.mode === "mock" ? "Synthetic offers" : "Live offers"} ·
              Simulated orders
            </span>
          </footer>
        </main>
      </div>
      {editingAgent && snapshot && (
        <AgentDrawer
          agent={editingAgent}
          template={snapshot.agents[0]?.mandate}
          categories={snapshot.categories}
          close={() => setEditingAgent(undefined)}
          refresh={refresh}
        />
      )}
      {selectedOrder && (
        <div
          className="modal-backdrop"
          onClick={() => setSelectedOrder(undefined)}
        >
          <section
            className="drawer order-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Order detail"
          >
            <button
              className="drawer-close icon-button"
              aria-label="Close order"
              onClick={() => setSelectedOrder(undefined)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">ORDER CONFIRMATION · SIMULATED</span>
            <h2 className="display">{selectedOrder.id}</h2>
            <div className="order-total">{money(selectedOrder.totalCents)}</div>
            <p className="muted">
              Delivery {day(selectedOrder.deliveryDate)} ·{" "}
              {selectedOrder.deliverySite}
            </p>
            <div className="verified-mark">
              <ShieldCheck size={16} /> Signed offer provenance recorded
            </div>
            <table className="detail-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {selectedOrder.lines.map((line) => (
                  <tr key={line.productId}>
                    <td>
                      {line.name}
                      <small className="mono">{line.productId}</small>
                    </td>
                    <td className="mono">
                      {count(line.qty)} {line.salesUnit}
                    </td>
                    <td className="mono">{money(line.lineTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="drawer-actions">
              <a
                className="secondary"
                href={`/api/orders/${selectedOrder.id}/peppol`}
              >
                <ArrowDownToLine size={15} /> Order XML
              </a>
              <button
                className="secondary"
                onClick={() =>
                  download(`${selectedOrder.id}.json`, selectedOrder)
                }
              >
                Export JSON
              </button>
            </div>
            <h3>Order timeline</h3>
            <Timeline
              events={
                snapshot?.events.filter(
                  (e) =>
                    e.refs.proposalId === selectedOrder.proposalId ||
                    e.refs.orderId === selectedOrder.id,
                ) ?? []
              }
            />
          </section>
        </div>
      )}
    </div>
  );
}
