import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { KitchenAgent } from "../apps/gateway/src/purchasing/agent";
import { localInterpret } from "../apps/gateway/src/purchasing/interpret";
import { setup, delivery, testConfig } from "./helpers";
import { createApp } from "../apps/gateway/src/http";
import type {
  KitchenIntent,
  KitchenProfile,
  PurchasePlan,
} from "../packages/purchasing/src/contracts";
let ctx: Awaited<ReturnType<typeof setup>>, engine: KitchenAgent;
let intent: KitchenIntent;
const meal = (): KitchenIntent => ({
  summary: "Tomato pasta for 80",
  dishes: [
    {
      recipeId: "tomato-pasta",
      name: "Tomato & basil pasta",
      portions: 80,
      claims: [],
    },
  ],
  items: [],
  pantry: [],
  claims: [],
  budgetPerPortion: null,
  unresolved: [],
});
beforeAll(async () => {
  ctx = await setup();
  intent = meal();
  engine = new KitchenAgent(ctx.service, async () => ({
    intent: structuredClone(intent),
    mode: "local",
  }));
});
afterAll(async () => {
  await ctx.service.closeDiscovery();
  await ctx.service.db.close();
});
async function saved(id: "lunch" | "hotel") {
  const p = await engine.profile(ctx.agent, id);
  if (p.revision) return p;
  return save(p);
}
async function save(profile: KitchenProfile) {
  const { customerId: _c, updatedAt: _t, ...input } = profile;
  return engine.saveProfile(ctx.agent, input);
}
async function settled(id: string) {
  for (let i = 0; i < 200; i++) {
    const p = await engine.get(ctx.agent, id);
    if (p.status !== "working") return p;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Plan did not finish");
}
async function start(profileId: "lunch" | "hotel" = "lunch") {
  await saved(profileId);
  const p = await engine.start(ctx.agent, {
    profileId,
    text: "Test request",
    date: delivery,
    key: randomUUID(),
  });
  return settled(p.id);
}
describe("bounded kitchen purchasing agent", () => {
  it("requires explicit preference saving and prevents stale profile overwrites", async () => {
    await expect(
      engine.start(ctx.agent, {
        profileId: "lunch",
        text: "Menu",
        date: delivery,
        key: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "PROFILE_NOT_SAVED" });
    const p = await engine.profile(ctx.agent, "lunch");
    await save(p);
    await expect(save(p)).rejects.toMatchObject({ code: "STALE_PROFILE" });
  });
  it("scales sourced weights and deducts only confirmed pantry quantities", async () => {
    intent = {
      ...meal(),
      pantry: [{ ingredient: "fresh pasta", amountKg: 5 }],
    };
    const p = await start();
    expect(p.status).toBe("ready");
    const pasta = p.rows.find((r) => r.ingredient === "Fresh pasta")!;
    expect(pasta.required).toBe(1.4);
    expect(pasta.pantryUsed).toBe(5);
    expect(
      pasta.candidates.find((c) => c.product.id === pasta.selectedId)?.qty,
    ).toBe(6);
    expect(pasta.status).toBe("ready");
    expect(p.events.every((e) => e.state === "done")).toBe(true);
    expect(
      p.rows.some((r) => r.required === null && r.status === "attention"),
    ).toBe(true);
    await expect(
      engine.export(ctx.agent, { id: p.id, revision: p.revision }),
    ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
  });
  it("does not invent a quantity for 'already have pasta'", async () => {
    intent = {
      ...meal(),
      pantry: [{ ingredient: "fresh pasta", amountKg: null }],
    };
    const p = await start();
    const row = p.rows.find((r) => r.ingredient === "Fresh pasta")!;
    expect(row.required).toBe(6.4);
    expect(row.pantryUnknown).toBe(true);
    expect(row.status).toBe("attention");
  });
  it("enforces recipe coverage when a manual pack count is too small and recomputes portion edits", async () => {
    intent = {
      ...meal(),
      pantry: [{ ingredient: "fresh pasta", amountKg: 5 }],
    };
    let p = await start();
    const row = p.rows.find((r) => r.ingredient === "Fresh pasta")!;
    p = await engine.update(ctx.agent, {
      id: p.id,
      revision: p.revision,
      row: { id: row.id, productId: row.selectedId, qty: 1 },
    });
    expect(p.rows.find((r) => r.id === row.id)?.status).toBe("attention");
    const next = {
      ...p.intent!,
      dishes: p.intent!.dishes.map((d) => ({ ...d, portions: 120 })),
    };
    p = await engine.update(ctx.agent, {
      id: p.id,
      revision: p.revision,
      intent: next,
    });
    p = await settled(p.id);
    const revised = p.rows.find((r) => r.id === row.id)!;
    expect(revised.required).toBe(4.6);
    expect(
      revised.candidates.find((c) => c.product.id === revised.selectedId)?.qty,
    ).toBe(19);
  });
  it("prepares only an explicitly approved available hotel substitute without placing an order", async () => {
    const profile = await saved("hotel");
    intent = {
      summary: "Breakfast",
      dishes: [],
      items: profile.preferences.map((p) => ({
        query: p.key,
        quantity: p.quantity,
        unit: "sales",
      })),
      pantry: [],
      claims: [],
      budgetPerPortion: null,
      unresolved: [],
    };
    const p = await start("hotel");
    expect(p.status).toBe("ready");
    expect(p.rows.every((r) => r.status === "ready")).toBe(true);
    expect(p.rows[0]?.selectedId).toBe("476812");
    expect(p.rows[1]?.selectedId).toBe("475797");
    const basket = await engine.export(ctx.agent, {
      id: p.id,
      revision: p.revision,
    });
    expect(basket.lines.find((l) => l.product.id === "476812")?.qty).toBe(20);
    expect(await ctx.service.db.transaction((r) => r.all("orders"))).toEqual(
      [],
    );
  });
  it("never substitutes an exact product and invalidates drafts after preferences change", async () => {
    const old = await saved("hotel");
    intent = {
      summary: "Yoghurt",
      dishes: [],
      items: [{ query: "breakfast yoghurt", quantity: 20, unit: "sales" }],
      pantry: [],
      claims: [],
      budgetPerPortion: null,
      unresolved: [],
    };
    const before = await start("hotel");
    const exact = await save({
      ...old,
      preferences: old.preferences.map((p) => ({ ...p, mode: "exact" })),
    });
    await expect(
      engine.export(ctx.agent, { id: before.id, revision: before.revision }),
    ).rejects.toMatchObject({ code: "PROFILE_CHANGED" });
    const p = await start("hotel");
    expect(p.rows[0]?.selectedId).toBe("476824");
    expect(p.rows[0]?.status).toBe("attention");
    expect(p.rows[0]?.candidates).toHaveLength(1);
    await save({ ...exact, preferences: old.preferences });
  });
  it("preserves strict allergen requirements instead of assuming absent supplier data is free-from", async () => {
    const strict = {
      ...ctx.agent,
      mandate: { ...ctx.agent.mandate, allergenProfile: "strict" as const },
    };
    const profile = await saved("hotel");
    intent = {
      summary: "Breakfast",
      dishes: [],
      items: [
        { query: profile.preferences[0]!.key, quantity: 20, unit: "sales" },
      ],
      pantry: [],
      claims: [],
      budgetPerPortion: null,
      unresolved: [],
    };
    const task = await engine.start(strict, {
      profileId: "hotel",
      text: "Usual",
      date: delivery,
      key: randomUUID(),
    });
    const p = await settled(task.id);
    expect(p.rows[0]?.candidates.some((c) => c.product.id === "476812")).toBe(
      false,
    );
    expect(p.rows[0]?.status).toBe("attention");
  });
  it("keeps unknown stock and unknown recipes unresolved", async () => {
    intent = {
      ...meal(),
      dishes: [
        {
          recipeId: "invented-salmon",
          name: "Salmon pasta",
          portions: 90,
          claims: [],
        },
      ],
      items: [{ query: "460001", quantity: 2, unit: "sales" }],
    };
    const p = await start();
    expect(p.issues.join(" ")).toContain("sourced recipe");
    expect(p.rows[0]?.candidates.map((c) => c.product.id)).toEqual(["460001"]);
    expect(p.rows[0]?.exact).toBe(true);
    expect(p.rows[0]?.status).toBe("attention");
  });
  it("scopes tasks to their buyer and rejects invented candidate and stale revision edits", async () => {
    intent = meal();
    const p = await start();
    await expect(
      engine.get({ ...ctx.agent, customerId: "other" }, p.id),
    ).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
    await expect(
      engine.update(ctx.agent, {
        id: p.id,
        revision: p.revision,
        row: { id: p.rows[0]!.id, productId: "made-up", qty: 1 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_SELECTION" });
    await expect(
      engine.update(ctx.agent, {
        id: p.id,
        revision: p.revision + 1,
        intent: p.intent,
      }),
    ).rejects.toMatchObject({ code: "STALE_PLAN" });
  });
  it("rejects a reviewed plan after purchasing policy changes", async () => {
    const profile = await saved("hotel");
    intent = {
      summary: "Breakfast",
      dishes: [],
      items: profile.preferences.map((p) => ({
        query: p.key,
        quantity: p.quantity,
        unit: "sales",
      })),
      pantry: [],
      claims: [],
      budgetPerPortion: null,
      unresolved: [],
    };
    const p = await start("hotel");
    await expect(
      engine.export(
        {
          ...ctx.agent,
          mandate: {
            ...ctx.agent.mandate,
            version: ctx.agent.mandate.version + 1,
          },
        },
        { id: p.id, revision: p.revision },
      ),
    ).rejects.toMatchObject({ code: "POLICY_CHANGED" });
  });
  it("does not substitute pepper-flavoured snacks for recipe seasoning", async () => {
    intent = meal();
    const p = await start();
    const row = p.rows.find((r) => r.ingredient === "Black pepper")!;
    expect(row.candidates.length).toBeGreaterThan(0);
    expect(
      row.candidates.every(
        (c) => !/chips|ketchup/i.test(c.product.names.en || ""),
      ),
    ).toBe(true);
  });
  it("checks the kitchen budget and never silently deducts duplicate pantry entries", async () => {
    intent = {
      ...meal(),
      budgetPerPortion: 0.01,
      pantry: [
        { ingredient: "fresh pasta", amountKg: 5 },
        { ingredient: "fresh pasta", amountKg: 5 },
      ],
    };
    const p = await start();
    expect(p.budgetExceeded).toBe(true);
    expect(p.rows.find((r) => r.ingredient === "Fresh pasta")?.required).toBe(
      1.4,
    );
    expect(p.issues.join(" ")).toContain("repeated");
  });
  it("does not duplicate a repeated start and rejects changed idempotent input", async () => {
    intent = meal();
    const input = {
      profileId: "lunch",
      text: "First",
      date: delivery,
      key: randomUUID(),
    };
    const p = await engine.start(ctx.agent, input);
    expect((await engine.start(ctx.agent, input)).id).toBe(p.id);
    await expect(
      engine.start(ctx.agent, { ...input, text: "Changed" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await settled(p.id);
  });
  it("requires all buyer scopes and exposes no approval capability", async () => {
    const app = createApp(ctx.service, testConfig);
    const post = (body: unknown, token = "test-buyer") => ({
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    expect(
      (await app.request("/v1/kitchen/profiles", post({}, "wrong"))).status,
    ).toBe(401);
    await ctx.service.db.transaction((r) =>
      r.put("agents", { ...ctx.agent, scopes: ["catalog:read"] }),
    );
    expect((await app.request("/v1/kitchen/profiles", post({}))).status).toBe(
      403,
    );
    await ctx.service.db.transaction((r) => r.put("agents", ctx.agent));
    expect((await app.request("/v1/kitchen/profiles", post({}))).status).toBe(
      200,
    );
  });
  it("does not treat an order budget as a per-portion allowance in the local fallback", async () => {
    const profile = await saved("lunch");
    const input = {
      profileId: "lunch" as const,
      text: "tomato pasta for 80 under 100 euros",
      date: delivery,
      key: randomUUID(),
    };
    const total = localInterpret(input, profile, null);
    expect(total.budgetPerPortion).toBeNull();
    expect(total.unresolved.join(" ")).toContain("budget per portion");
    expect(
      localInterpret(
        { ...input, text: "tomato pasta for 80 under 3 euros per portion" },
        profile,
        null,
      ).budgetPerPortion,
    ).toBe(3);
  });
  it("keeps unsupported voice/photo inputs explicit when the local fallback is used", async () => {
    const profile = await saved("lunch");
    const p = localInterpret(
      {
        profileId: "lunch",
        text: "salmon pasta for 90",
        date: delivery,
        key: randomUUID(),
        media: { mimeType: "image/png", data: "AAAA" },
      },
      profile,
      null,
    );
    expect(p.dishes[0]?.recipeId).toBeNull();
    expect(p.unresolved.join(" ")).toContain("Gemini");
  });
});
