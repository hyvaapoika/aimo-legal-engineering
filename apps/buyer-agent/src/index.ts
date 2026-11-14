import "dotenv/config";
import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { randomUUID } from "node:crypto";
import { canonical, signRequest } from "@aimo/signing";
import { chooseOffer } from "./planner.js";
import { compactVerify, createLocalJWKSet } from "jose";
import {
  proposalInputSchema,
  type Offer,
  type Proposal,
  type ProposalLine,
  type Product,
} from "@aimo/schema";
import { z } from "zod";

const url = process.env.PUBLIC_GATEWAY_URL || "http://localhost:4000";
const key = JSON.parse(
  await readFile(process.env.BUYER_KEY_PATH || ".local/buyer-key.json", "utf8"),
);
const agentId = process.env.BUYER_AGENT_ID || "hotel-haven-buyer";
async function request<T>(path: string, input?: unknown): Promise<T> {
  const body = input ? JSON.stringify(input) : "";
  const method = input ? "POST" : "GET";
  const target = `${url}${path}`;
  const signature = await signRequest(method, target, body, key, agentId);
  const response = await fetch(target, {
    method,
    headers: { ...signature, "Content-Type": "application/json" },
    body: body || undefined,
  });
  if (!response.ok)
    throw new Error(`Gateway ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}
const rowSchema = z.object({
  productId: z.string(),
  hint: z.string(),
  onHand: z.coerce.number().nonnegative(),
  target: z.coerce.number().positive(),
  weeklyUsage: z.coerce.number().nonnegative(),
  unit: z.enum(["L", "KG", "PCS"]),
  requiredClaim: z.string(),
});
const rows = z
  .array(rowSchema)
  .parse(
    parse(
      await readFile(
        process.env.INVENTORY_PATH || "data/inventory.csv",
        "utf8",
      ),
      { columns: true, skip_empty_lines: true },
    ),
  );
const requestedDate =
  process.env.REQUESTED_DATE ||
  new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const needed = rows.filter((r) => r.target > r.onHand);
if (!needed.length) {
  console.log("Inventory is already at target.");
  process.exit(0);
}
const jwks = createLocalJWKSet(
  await (await fetch(`${url}/.well-known/jwks.json`)).json(),
);
async function getOffers(productIds: string[], substitutes: string[] = []) {
  const batch = await request<{ offers: Offer[] }>("/v1/offers", {
    productIds,
    requestedDate,
    includeSubstitutesFor: substitutes,
  });
  for (const offer of batch.offers) {
    const { signature, ...payload } = offer;
    const verified = await compactVerify(signature, jwks, {
      algorithms: ["EdDSA"],
    });
    if (new TextDecoder().decode(verified.payload) !== canonical(payload))
      throw new Error("Offer content differs from its signed payload.");
  }
  return batch.offers;
}
const offers = await getOffers(
  needed.map((r) => r.productId),
  needed.map((r) => r.productId),
);
const lines: ProposalLine[] = [];
for (const row of needed) {
  const original = offers.find((o) => o.productId === row.productId)!;
  const need = {
    productId: row.productId,
    qty: row.target - row.onHand,
    unit: row.unit,
    requiredClaim: row.requiredClaim,
  };
  const candidates = [
    original,
    ...offers.filter(
      (o) =>
        o.productId !== original.productId &&
        (o.product.category === original.product.category ||
          original.product.substitutions.includes(o.productId)),
    ),
  ];
  let selected = chooseOffer(need, candidates, requestedDate);
  if (!selected) {
    const search = new URLSearchParams({
      category: original.product.category,
      claims: row.requiredClaim,
      limit: "10",
    });
    const result = await request<{ products: Product[] }>(
      `/v1/catalog/search?${search}`,
    );
    const ids = result.products
      .filter((p) => !candidates.some((o) => o.productId === p.id))
      .map((p) => p.id)
      .slice(0, 5);
    if (ids.length)
      selected = chooseOffer(need, await getOffers(ids), requestedDate);
  }
  if (!selected)
    throw new Error(
      `No feasible declared-safe alternative for ${row.productId}; no proposal submitted.`,
    );
  lines.push(selected.line);
  console.log(
    `${row.hint}: ${selected.line.productId} · ${selected.line.qty} ${selected.line.salesUnit}${selected.line.substituteFor ? " · substitution requires mandate check" : ""}`,
  );
}
const proposal = proposalInputSchema.parse({
  requestedDate,
  deliverySite: process.env.DELIVERY_SITE || "haven-kitchen",
  idempotencyKey: process.env.IDEMPOTENCY_KEY || randomUUID(),
  requirementRef: "inventory.csv",
  lines,
});
const result = await request<Proposal>("/v1/proposals", proposal);
console.log(
  JSON.stringify(
    {
      proposalId: result.id,
      status: result.status,
      orderId: result.orderId,
      total: result.totalCents / 100,
      currency: "EUR",
      rules: result.verdict.firedRules,
    },
    null,
    2,
  ),
);
if (result.status === "held" && process.argv.includes("--wait")) {
  const end = Date.now() + 10 * 60_000;
  while (Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const current = await request<Proposal>(`/v1/proposals/${result.id}`);
    if (current.status !== "held") {
      console.log(JSON.stringify(current, null, 2));
      break;
    }
  }
}
