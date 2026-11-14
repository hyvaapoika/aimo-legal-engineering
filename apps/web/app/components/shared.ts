import type {
  Agent,
  Approval,
  LedgerEvent,
  Order,
  Proposal,
} from "@aimo/schema";
export type SafeAgent = Omit<Agent, "tokenHash">;
export type Snapshot = {
  agents: SafeAgent[];
  approvals: Approval[];
  proposals: Proposal[];
  orders: Order[];
  events: LedgerEvent[];
  catalogCount: number;
  mode: string;
  categories: string[];
};
export type View =
  | "overview"
  | "approvals"
  | "agents"
  | "orders"
  | "activity"
  | "catalog"
  | "discovery";
export const money = (cents: number) =>
  new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
export const count = (n: number) =>
  new Intl.NumberFormat("en-FI", { maximumFractionDigits: 2 }).format(n);
export const day = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Helsinki",
  });
export const time = (value: string) =>
  new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Helsinki",
  });
export const short = (id: string) => id.slice(0, 8);
export const title = (event: LedgerEvent) =>
  ({
    "agent.registered": "Purchasing agent registered",
    "catalog.searched": "Product catalog searched",
    "offers.returned": "Signed offers issued",
    "substitutes.proposed": "Substitution options compared",
    "proposal.submitted": "Purchase proposal received",
    "rules.evaluated": `Policy evaluated · ${event.payload.result ?? ""}`,
    "approval.requested": "Human decision requested",
    "approval.decided": `Human decision · ${event.payload.decision ?? ""}`,
    "order.placed": "Order placed on fixed prices",
    "request.refused": "Purchase refused by a guardrail",
    "agent.updated": "Agent authority updated",
    "approval.channel_attempted": "Approval routed to inbox",
    "order.exported": "Order XML exported",
  })[event.type] || event.type.replaceAll(".", " ").replaceAll("_", " ");
export async function api<T>(
  path: string,
  input?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: input === undefined ? "GET" : method,
    headers:
      input === undefined ? undefined : { "Content-Type": "application/json" },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.message || "Request failed"), {
      status: response.status,
    });
  return data;
}
export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
