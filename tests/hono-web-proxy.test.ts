import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { setup, testConfig } from "./helpers.js";
import { createApp } from "../apps/gateway/src/http.js";

let ctx: Awaited<ReturnType<typeof setup>>;
let web: Server;
let webPort = 0;

beforeAll(async () => {
  ctx = await setup();
  web = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          url: request.url,
          host: request.headers.host,
          forwardedHost: request.headers["x-forwarded-host"],
          proto: request.headers["x-forwarded-proto"],
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
  });
  await new Promise<void>((resolve) =>
    web.listen(0, "127.0.0.1", () => resolve()),
  );
  webPort = (web.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    web.close((error) => (error ? reject(error) : resolve())),
  );
  await ctx.service.closeDiscovery();
  await ctx.service.db.close();
});

describe("Railway web reverse proxy", () => {
  it("forwards unknown page and API requests to the private Next.js server", async () => {
    const app = createApp(ctx.service, {
      ...testConfig,
      proxyWeb: true,
      webPort,
    });
    const body = JSON.stringify({ demo: true });
    const response = await app.request("/api/example?view=full", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "demo.example",
        "x-forwarded-proto": "https",
      },
      body,
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      url: "/api/example?view=full",
      forwardedHost: "demo.example",
      proto: "https",
      body,
    });
    expect(result.host).toMatch(/^127\.0\.0\.1:\d+$/);
  });
});
