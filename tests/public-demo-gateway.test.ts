import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../apps/gateway/src/http.js";
import { setup, testConfig } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => {
  await ctx.service.closeDiscovery();
  await ctx.service.db.close();
});

describe("public demo gateway capabilities", () => {
  it("allows the explicitly enabled purchase demo while keeping voice disabled", async () => {
    const app = createApp(ctx.service, {
      ...testConfig,
      demo: false,
      publicDemo: true,
    });
    const response = await app.request("/admin/demo/purchase", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-admin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idempotencyKey: randomUUID() }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).proposal).toMatchObject({
      agentId: "hotel-haven-buyer",
      status: "held",
    });
    const voice = await app.request("/admin/voice/start", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-admin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ approvalId: randomUUID() }),
    });
    expect(voice.status).toBe(403);
  });
});
