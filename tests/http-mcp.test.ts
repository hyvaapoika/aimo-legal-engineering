import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { setup, testConfig, now, delivery } from "./helpers.js";
import { createApp } from "../apps/gateway/src/http.js";
import { signRequest } from "@aimo/signing";
import { LiveValioClient } from "@aimo/valio-client";
let ctx: Awaited<ReturnType<typeof setup>>;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  ctx = await setup();
  app = createApp(ctx.service, testConfig);
});
afterAll(async () => {
  await ctx.service.closeDiscovery();
  await ctx.service.db.close();
});
describe("HTTP identity and interoperability", () => {
  it("publishes discovery but protects commerce and admin routes", async () => {
    expect((await app.request("/.well-known/aimo-agent.json")).status).toBe(
      200,
    );
    expect((await app.request("/v1/catalog/search")).status).toBe(401);
    expect(
      (
        await app.request("/admin/snapshot", {
          headers: { Authorization: "Bearer test-buyer" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request("/admin/snapshot", {
          headers: { Authorization: "Bearer test-admin" },
        })
      ).status,
    ).toBe(200);
  });
  it("requires catalogue scope for smart discovery and keeps approvals human-only", async () => {
    expect(
      (
        await app.request("/v1/discovery/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    const original = ctx.agent.scopes;
    await ctx.service.db.transaction((repo) =>
      repo.put("agents", { ...ctx.agent, scopes: ["offers:read"] }),
    );
    expect(
      (
        await app.request("/v1/discovery/search", {
          method: "POST",
          headers: {
            Authorization: "Bearer test-buyer",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    await ctx.service.db.transaction((repo) =>
      repo.put("agents", { ...ctx.agent, scopes: original }),
    );
    const r = await app.request("/v1/discovery/search", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-buyer",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "464249" }),
    });
    expect(r.status).toBe(200);
    expect((await r.json()).products[0].id).toBe("464249");
    expect(
      (
        await app.request("/admin/approvals/example/decide", {
          method: "POST",
          headers: {
            Authorization: "Bearer test-buyer",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ decision: "approve" }),
        })
      ).status,
    ).toBe(401);
  });
  it("verifies signed requests and rejects nonce replay and query tampering", async () => {
    const url = "http://localhost/v1/catalog/search?query=milk";
    const headers = await signRequest(
      "GET",
      url,
      "",
      ctx.buyerKeys.privateKey,
      ctx.agent.id,
      now,
    );
    expect((await app.request(url, { headers })).status).toBe(200);
    const replay = await app.request(url, { headers });
    expect(replay.status).toBe(401);
    expect((await replay.json()).code).toBe("REPLAY");
    const fresh = await signRequest(
      "GET",
      url,
      "",
      ctx.buyerKeys.privateKey,
      ctx.agent.id,
      now,
    );
    expect((await app.request(`${url}x`, { headers: fresh })).status).toBe(401);
  });
  it("refuses hostile origins and agent credentials without a required scope", async () => {
    expect(
      (
        await app.request("/v1/catalog/search", {
          headers: {
            Origin: "https://evil.example",
            Authorization: "Bearer test-buyer",
          },
        })
      ).status,
    ).toBe(403);
    const original = ctx.agent.scopes;
    await ctx.service.db.transaction((repo) =>
      repo.put("agents", { ...ctx.agent, scopes: [] }),
    );
    expect(
      (
        await app.request("/v1/catalog/search", {
          headers: { Authorization: "Bearer test-buyer" },
        })
      ).status,
    ).toBe(403);
    await ctx.service.db.transaction((repo) =>
      repo.put("agents", { ...ctx.agent, scopes: original }),
    );
  });
  it("supports a real MCP SDK client across initialization, tool listing, and purchase tools", async () => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) =>
      server.listening ? resolve() : server.once("listening", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No server port");
    const client = new Client({ name: "integration-test", version: "1.0.0" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${address.port}/mcp`),
          { requestInit: { headers: { Authorization: "Bearer test-buyer" } } },
        ),
      );
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          "search_catalog",
          "discover_products",
          "compare_products",
          "find_alternatives",
          "get_offers",
          "submit_proposal",
          "get_proposal",
          "get_order",
        ]),
      );
      const search = await client.callTool({
        name: "search_catalog",
        arguments: { query: "lactose-free milk", limit: 3 },
      });
      expect(search.isError).not.toBe(true);
      const offersResult = await client.callTool({
        name: "get_offers",
        arguments: { productIds: ["464201"], requestedDate: delivery },
      });
      const content = offersResult.content as { type: string; text: string }[];
      const offer = JSON.parse(content[0]!.text).offers[0];
      const submitted = await client.callTool({
        name: "submit_proposal",
        arguments: {
          requestedDate: delivery,
          deliverySite: "haven-kitchen",
          idempotencyKey: "mcp-order-1",
          lines: [
            {
              productId: offer.productId,
              qty: 100,
              salesUnit: "ST",
              offerId: offer.id,
            },
          ],
        },
      });
      expect(submitted.isError).not.toBe(true);
      const proposal = JSON.parse(
        (submitted.content as { text: string }[])[0]!.text,
      );
      expect(proposal.status).toBe("placed");
      expect(
        (
          await client.callTool({
            name: "get_order",
            arguments: { id: proposal.orderId },
          })
        ).isError,
      ).not.toBe(true);
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
describe("Valio API contract", () => {
  it("sends exactly two shortlist requests with X-API-Key and the supplied request shape", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(url), init });
      return Response.json(
        String(url).endsWith("/price")
          ? {
              customerId: "customer",
              currency: "EUR",
              pricingDate: delivery,
              products: [],
            }
          : {
              timeNow: now.toISOString(),
              requestedDate: delivery,
              products: [],
            },
      );
    }) as typeof fetch;
    const client = new LiveValioClient(
      "https://junction26.valioaimo.fi",
      "not-a-real-key",
      fetcher,
    );
    await client.lookup(
      "customer",
      [ctx.service.catalog.get("464201")],
      delivery,
    );
    expect(calls.map((c) => c.url)).toEqual([
      "https://junction26.valioaimo.fi/api/price",
      "https://junction26.valioaimo.fi/api/availability",
    ]);
    expect(new Headers(calls[0]!.init?.headers).get("X-API-Key")).toBe(
      "not-a-real-key",
    );
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({
      customer: "customer",
      requestedDate: delivery,
      products: ["464201"],
    });
  });
  it("does not silently replace failed live requests with mock prices", async () => {
    const client = new LiveValioClient(
      "https://junction26.valioaimo.fi",
      "key",
      (async () => new Response("", { status: 429 })) as typeof fetch,
    );
    await expect(
      client.lookup("customer", [ctx.service.catalog.get("464201")], delivery),
    ).rejects.toMatchObject({ code: "VALIO_RATE_LIMIT" });
  });
});
