import { KitchenAgent, publicPlan } from "./purchasing/agent.js";
import { planRefSchema } from "../../../packages/purchasing/src/contracts";
import { Hono } from "hono";
import { proxy } from "hono/proxy";
import { bodyLimit } from "hono/body-limit";
import { z, ZodError } from "zod";
import {
  DomainError,
  decisionSchema,
  mandateSchema,
  searchSchema,
  type Agent,
  type Order,
} from "@aimo/schema";
import { constantEqual, sha256, verifyRequest } from "@aimo/signing";
import { exportOrder } from "@aimo/peppol";
import { GatewayService, DEMO_AGENT, DEMO_CUSTOMER } from "./service.js";
import type { Configuration } from "./config.js";
import { handleMcp } from "./mcp.js";
import { discovery, openapi } from "./openapi.js";
import { runDemoScenario, runPurchaseDemo } from "./scenario.js";

import { browserVoice, type BrowserVoice } from "./voice/browser.js";

export function createApp(
  service: GatewayService,
  config: Configuration,
  voiceAdapter?: BrowserVoice,
) {
  const kitchen = new KitchenAgent(service);
  const voice = voiceAdapter ?? browserVoice(service, config.stateDir);
  const app = new Hono<{ Variables: { agent: Agent } }>();
  const limits = new Map<string, { count: number; reset: number }>();
  app.use("*", (c, next) =>
    bodyLimit({
      maxSize: c.req.path === "/v1/kitchen/start" ? 4_500_000 : 1_000_000,
    })(c, next),
  );
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");
    const origin = c.req.header("origin");
    if (origin && origin !== config.webOrigin && origin !== config.publicUrl)
      return c.json(
        { code: "ORIGIN_REFUSED", message: "Origin is not allowed." },
        403,
      );
    await next();
  });
  app.onError(async (error, c) => {
    if (
      c.req.path.startsWith("/v1/") ||
      c.req.path === "/mcp" ||
      c.req.path.startsWith("/admin/")
    ) {
      const agent = c.get("agent");
      await service
        .audit(
          "request.refused",
          agent?.customerId ?? DEMO_CUSTOMER,
          agent?.id ?? "unauthenticated",
          {
            path: c.req.path,
            code:
              error instanceof DomainError
                ? error.code
                : error instanceof ZodError || error instanceof SyntaxError
                  ? "INVALID_REQUEST"
                  : "INTERNAL_ERROR",
          },
        )
        .catch(() => undefined);
    }
    if (error instanceof SyntaxError)
      return c.json(
        {
          code: "INVALID_JSON",
          message: "Request body must contain valid JSON.",
        },
        400,
      );
    if (error instanceof ZodError)
      return c.json(
        {
          code: "VALIDATION_ERROR",
          message: "Request did not match the schema.",
          details: error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        },
        400,
      );
    if (error instanceof DomainError)
      return c.json(
        { code: error.code, message: error.message, details: error.details },
        error.status as 400,
      );
    console.error(
      "Gateway error:",
      error instanceof Error ? error.name : "unknown",
    );
    return c.json(
      { code: "INTERNAL_ERROR", message: "Unexpected gateway error." },
      500,
    );
  });
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      mode: service.valio.source,
      catalogCount: service.catalog.products.length,
    }),
  );
  app.get("/.well-known/aimo-agent.json", (c) =>
    c.json(discovery(config.publicUrl)),
  );
  app.get("/.well-known/jwks.json", (c) =>
    c.json({ keys: [service.signer.publicKey] }),
  );
  app.get("/.well-known/agent-card.json", (c) =>
    c.json({
      name: "Aimo Agent Gateway",
      description:
        "Fixed-price purchasing through deterministic mandates and human approvals.",
      url: `${config.publicUrl}/mcp`,
      version: "0.1.0",
      protocolVersion: "0.3.0",
      capabilities: { streaming: false },
      defaultInputModes: ["application/json"],
      defaultOutputModes: ["application/json"],
      skills: [
        "search_catalog",
        "get_offers",
        "submit_proposal",
        "get_proposal",
        "get_order",
      ].map((id) => ({
        id,
        name: id,
        description: id.replaceAll("_", " "),
        tags: ["commerce"],
      })),
      documentationUrl: `${config.publicUrl}/openapi.json`,
    }),
  );
  app.get("/openapi.json", (c) => c.json(openapi(config.publicUrl)));
  app.use("/admin/*", async (c, next) => {
    const bearer = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
    if (!constantEqual(sha256(bearer), sha256(config.adminToken)))
      throw new DomainError(
        "UNAUTHORIZED",
        "Administrator sign-in required.",
        401,
      );
    await next();
  });
  const authenticate = async (request: Request) => {
    let agent: Agent;
    if (request.headers.has("signature-input")) {
      const key = /;keyid="([A-Za-z0-9_-]+)"/.exec(
        request.headers.get("signature-input")!,
      )?.[1];
      if (!key)
        throw new DomainError("UNAUTHORIZED", "Missing signing key ID.", 401);
      agent = await service.agent(key);
      const verified = await verifyRequest(
        request,
        agent.publicKey,
        agent.id,
        service.now(),
      );
      await service.db.transaction(async (repo) => {
        await repo.sql.query(
          "DELETE FROM request_nonces WHERE expires_at < $1",
          [service.now().toISOString()],
        );
        const nonce = `${agent.id}:${verified.nonce}`;
        const exists = await repo.sql.query(
          "SELECT nonce FROM request_nonces WHERE nonce=$1",
          [nonce],
        );
        if (exists.rows.length)
          throw new DomainError(
            "REPLAY",
            "Signed request was already used.",
            401,
          );
        await repo.sql.query(
          "INSERT INTO request_nonces(nonce,expires_at) VALUES ($1,$2)",
          [nonce, verified.expiresAt],
        );
      });
    } else {
      if (!config.allowBearer)
        throw new DomainError(
          "SIGNATURE_REQUIRED",
          "Use an Ed25519 signed request.",
          401,
        );
      const bearer = request.headers.get("authorization");
      if (!bearer?.startsWith("Bearer "))
        throw new DomainError(
          "UNAUTHORIZED",
          "Agent credentials required.",
          401,
        );
      agent = await service.agentByToken(bearer.slice(7));
    }
    if (
      !agent.active ||
      Date.parse(agent.mandate.validTo) <= service.now().getTime()
    )
      throw new DomainError(
        "AGENT_INACTIVE",
        "Agent or mandate is inactive.",
        403,
      );
    const now = Date.now();
    const limit = limits.get(agent.id);
    if (!limit || now >= limit.reset)
      limits.set(agent.id, { count: 1, reset: now + 60_000 });
    else {
      limit.count++;
      if (limit.count > 120)
        throw new DomainError(
          "RATE_LIMIT",
          "Too many requests; retry in a minute.",
          429,
        );
    }
    await service.audit("request.received", agent.customerId, agent.id, {
      method: request.method,
      path: new URL(request.url).pathname,
    });
    return agent;
  };
  app.use("/v1/*", async (c, next) => {
    const agent = await authenticate(c.req.raw);
    c.set("agent", agent);
    const scope: Agent["scopes"][number] =
      c.req.path.includes("/catalog") || c.req.path.includes("/discovery")
        ? "catalog:read"
        : c.req.path === "/v1/offers"
          ? "offers:read"
          : c.req.method === "POST"
            ? "proposals:write"
            : "orders:read";
    if (
      c.req.path.startsWith("/v1/kitchen/") &&
      !["catalog:read", "offers:read", "proposals:write"].every((s) =>
        agent.scopes.includes(s as Agent["scopes"][number]),
      )
    )
      throw new DomainError(
        "MISSING_SCOPE",
        "Kitchen planning requires catalogue, offers and proposal scopes.",
        403,
      );
    if (!agent.scopes.includes(scope))
      throw new DomainError("MISSING_SCOPE", `Requires ${scope}.`, 403);
    await next();
  });
  app.all("/mcp", async (c) => {
    const agent = await authenticate(c.req.raw);
    return handleMcp(c.req.raw, service, agent);
  });
  app.get("/v1/catalog/search", async (c) =>
    c.json(
      await service.search(
        c.get("agent"),
        searchSchema.parse({
          query: c.req.query("query"),
          category: c.req.query("category"),
          claims: c.req.query("claims")?.split(",").filter(Boolean),
          allergenFree: c.req.query("allergenFree")?.split(",").filter(Boolean),
          limit: c.req.query("limit")
            ? Number(c.req.query("limit"))
            : undefined,
        }),
      ),
    ),
  );
  app.get("/v1/discovery/context", (c) =>
    c.json({
      customerId: c.get("agent").customerId,
      deliverySites: c.get("agent").mandate.deliverySites,
      source: service.valio.source,
      today: new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Helsinki",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(service.now()),
    }),
  );
  app.post("/v1/discovery/suggest", async (c) =>
    c.json(service.discovery.suggest(await c.req.json())),
  );
  app.post("/v1/discovery/search", async (c) => {
    const input = await c.req.json();
    const result =
      process.env.DISCOVERY_LIGHTWEIGHT === "true"
        ? await service.discovery.searchLightweight(input)
        : await service.discovery.search(input);
    return c.json(result);
  });
  app.post("/v1/discovery/compare", async (c) => {
    const x = z
      .object({ ids: z.array(z.string()).min(1).max(3) })
      .strict()
      .parse(await c.req.json());
    return c.json(service.discovery.compare(x.ids));
  });
  app.post("/v1/discovery/alternatives", async (c) => {
    const x = z
      .object({ id: z.string() })
      .strict()
      .parse(await c.req.json());
    return c.json(service.discovery.alternatives(x.id));
  });
  app.post("/v1/kitchen/profiles", async (c) =>
    c.json(await kitchen.profiles(c.get("agent"))),
  );
  app.post("/v1/kitchen/profile", async (c) =>
    c.json(await kitchen.saveProfile(c.get("agent"), await c.req.json())),
  );
  app.post("/v1/kitchen/start", async (c) =>
    c.json(
      publicPlan(await kitchen.start(c.get("agent"), await c.req.json())),
      202,
    ),
  );
  app.post("/v1/kitchen/status", async (c) =>
    c.json(
      publicPlan(
        await kitchen.get(
          c.get("agent"),
          planRefSchema.parse(await c.req.json()).id,
        ),
      ),
    ),
  );
  app.post("/v1/kitchen/update", async (c) =>
    c.json(
      publicPlan(await kitchen.update(c.get("agent"), await c.req.json())),
    ),
  );
  app.post("/v1/kitchen/export", async (c) =>
    c.json(await kitchen.export(c.get("agent"), await c.req.json())),
  );
  app.post("/v1/offers", async (c) =>
    c.json(await service.getOffers(c.get("agent"), await c.req.json())),
  );
  app.post("/v1/proposals", async (c) =>
    c.json(await service.submit(c.get("agent"), await c.req.json())),
  );
  app.get("/v1/proposals/:id", async (c) =>
    c.json(await service.getProposal(c.get("agent"), c.req.param("id"))),
  );
  app.get("/v1/orders/:id", async (c) =>
    c.json(await service.getOrder(c.get("agent"), c.req.param("id"))),
  );
  app.get("/v1/orders/:id/peppol", async (c) => {
    const order = await service.getOrder(c.get("agent"), c.req.param("id"));
    await service.audit("order.exported", order.customerId, c.get("agent").id, {
      orderId: order.id,
    });
    return c.body(exportOrder(order), 200, {
      "Content-Type": "application/xml",
    });
  });
  app.get("/admin/snapshot", async (c) => c.json(await service.snapshot()));
  app.get("/admin/ledger/verify", async (c) =>
    c.json(await service.verifyLedger()),
  );
  app.get("/admin/catalog/search", async (c) =>
    c.json(
      await service.search(
        await service.agent(DEMO_AGENT),
        searchSchema.parse({ query: c.req.query("query"), limit: 30 }),
      ),
    ),
  );
  app.get("/admin/catalog/:id", (c) =>
    c.json(service.catalog.get(c.req.param("id"))),
  );
  app.post("/admin/agents", async (c) => {
    const input = z
      .object({ name: z.string().min(1).max(100), mandate: mandateSchema })
      .strict()
      .parse(await c.req.json());
    return c.json(await service.register(input.name, input.mandate));
  });
  app.patch("/admin/agents/:id", async (c) =>
    c.json(
      await service.updateAgent(
        c.req.param("id"),
        z
          .object({
            active: z.boolean().optional(),
            mandate: mandateSchema.optional(),
          })
          .strict()
          .parse(await c.req.json()),
      ),
    ),
  );
  app.post("/admin/approvals/:id/decide", async (c) =>
    c.json(
      await service.decide(
        c.req.param("id"),
        decisionSchema.parse(await c.req.json()),
        "maija",
      ),
    ),
  );
  app.post("/admin/demo", async (c) => {
    if (!config.demo && !config.publicDemo)
      throw new DomainError(
        "DEMO_DISABLED",
        "Scenario generation is only enabled in local mock mode.",
        403,
      );
    return c.json(await runDemoScenario(service));
  });
  app.use("/admin/voice/*", async (c, next) => {
    if (!config.demo)
      throw new DomainError(
        "DEMO_DISABLED",
        "Browser voice approval is limited to the simulated local demo.",
        403,
      );
    await next();
  });
  app.post("/admin/voice/start", async (c) => {
    const { approvalId } = z
      .object({ approvalId: z.string().uuid() })
      .strict()
      .parse(await c.req.json());
    return c.json(await voice.start(approvalId));
  });
  app.post("/admin/voice/prepare", async (c) =>
    c.json(voice.prepare(await c.req.json())),
  );
  app.post("/admin/voice/utterance", async (c) =>
    c.json(await voice.utterance(await c.req.json())),
  );
  app.post("/admin/voice/end", async (c) => {
    const { sessionId } = z
      .object({ sessionId: z.string().uuid() })
      .strict()
      .parse(await c.req.json());
    voice.end(sessionId);
    return c.json({ ok: true });
  });
  app.post("/admin/demo/purchase", async (c) => {
    if (!config.demo && !config.publicDemo)
      throw new DomainError(
        "DEMO_DISABLED",
        "Only available in the local mock demo.",
        403,
      );
    const { idempotencyKey } = z
      .object({ idempotencyKey: z.string().uuid() })
      .strict()
      .parse(await c.req.json());
    return c.json(await runPurchaseDemo(service, idempotencyKey));
  });
  app.get("/admin/orders/:id/peppol", async (c) => {
    const order = await service.db.transaction((repo) =>
      repo.get<Order>("orders", c.req.param("id")),
    );
    if (!order || order.customerId !== DEMO_CUSTOMER)
      throw new DomainError("NOT_FOUND", "Order not found.", 404);
    await service.audit("order.exported", order.customerId, "maija", {
      orderId: order.id,
    });
    return c.body(exportOrder(order), 200, {
      "Content-Type": "application/xml",
      "Content-Disposition": `attachment; filename="${order.id}.xml"`,
    });
  });
  app.notFound((c) => {
    if (!config.proxyWeb)
      return c.json({ code: "NOT_FOUND", message: "Endpoint not found." }, 404);
    const incoming = new URL(c.req.url);
    const target = new URL(
      incoming.pathname + incoming.search,
      `http://127.0.0.1:${config.webPort}`,
    );
    const originalHost =
      c.req.header("x-forwarded-host") || c.req.header("host");
    const headers = {
      ...c.req.header(),
      ...(originalHost
        ? { host: originalHost, "x-forwarded-host": originalHost }
        : {}),
      "x-forwarded-proto": c.req.header("x-forwarded-proto") || "https",
    };
    return proxy(target, { raw: c.req.raw, headers });
  });
  return app;
}
