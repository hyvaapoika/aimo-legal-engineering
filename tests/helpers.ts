import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { loadCatalog, type Catalog } from "@aimo/catalog";
import { createDatabase } from "@aimo/database";
import { generateKeys, Signer, sha256 } from "@aimo/signing";
import { MockValioClient } from "@aimo/valio-client";
import type { Agent, Offer, ProposalInput } from "@aimo/schema";
import {
  GatewayService,
  defaultMandate,
  DEMO_AGENT,
  DEMO_CUSTOMER,
} from "../apps/gateway/src/service.js";
import type { Configuration } from "../apps/gateway/src/config.js";

export const now = new Date("2026-11-14T10:00:00Z");
export const delivery = "2026-11-16";
let catalog: Catalog;
export async function testCatalog() {
  return (catalog ??= await loadCatalog(resolve("data")));
}
export async function setup() {
  const catalog = await testCatalog();
  const db = await createDatabase();
  const keys = await generateKeys();
  const buyerKeys = await generateKeys();
  const scenarios = JSON.parse(
    await readFile("data/fixtures/scenarios.json", "utf8"),
  );
  let clock = new Date(now);
  const service = new GatewayService(
    db,
    catalog,
    new MockValioClient(scenarios),
    new Signer(keys.privateKey, keys.publicKey),
    () => new Date(clock),
  );
  const agent: Agent = {
    id: DEMO_AGENT,
    customerId: DEMO_CUSTOMER,
    name: "Hotel Haven buyer",
    active: true,
    scopes: ["catalog:read", "offers:read", "proposals:write", "orders:read"],
    publicKey: buyerKeys.publicKey,
    tokenHash: sha256("test-buyer"),
    mandate: defaultMandate(["10400", "10412", "10500", "18701"], now),
    createdAt: now.toISOString(),
  };
  await db.transaction((repo) => repo.put("agents", agent));
  return {
    service,
    agent,
    keys,
    buyerKeys,
    setTime: (date: Date) => {
      clock = date;
    },
  };
}
export function input(offer: Offer, qty = 100): ProposalInput {
  return {
    requestedDate: delivery,
    deliverySite: "haven-kitchen",
    idempotencyKey: randomUUID(),
    lines: [
      {
        productId: offer.productId,
        qty,
        salesUnit: offer.product.salesUnit,
        offerId: offer.id,
        requiredClaims: [],
        allergenFree: [],
      },
    ],
  };
}
export const testConfig: Configuration = {
  mock: true,
  demo: true,
  adminToken: "test-admin",
  agentToken: "test-buyer",
  allowBearer: true,
  port: 0,
  publicUrl: "http://localhost",
  webOrigin: "http://localhost:3000",
  dataDir: resolve("data"),
  stateDir: resolve(".local/test"),
  valioBaseUrl: "https://junction26.valioaimo.fi",
  valioApiKey: "",
  databaseUrl: undefined,
};
