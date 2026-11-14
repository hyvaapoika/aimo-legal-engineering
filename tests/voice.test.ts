import { afterEach, describe, expect, it } from "vitest";
import { setup, input, delivery, now, testConfig } from "./helpers.js";
import { GatewayService } from "../apps/gateway/src/service.js";
import {
  BrowserVoice,
  spokenCommand,
} from "../apps/gateway/src/voice/browser.js";
import { createApp } from "../apps/gateway/src/http.js";
import { runPurchaseDemo } from "../apps/gateway/src/scenario.js";
import { randomUUID } from "node:crypto";
const databases: Awaited<ReturnType<typeof setup>>[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((c) => c.service.db.close()));
});
async function fixture() {
  const ctx = await setup();
  databases.push(ctx);
  const original = ctx.service;
  const service = new GatewayService(
    original.db,
    original.catalog,
    original.valio,
    original.signer,
    original.now,
    true,
  );
  const voice = new BrowserVoice(
    service,
    async () => "test-conversation-token",
  );
  const { offers } = await service.getOffers(ctx.agent, {
    productIds: ["464201"],
    requestedDate: delivery,
  });
  const proposal = await service.submit(ctx.agent, input(offers[0]!, 12));
  const session = await voice.start(proposal.approvalId!);
  const say = (transcript: string) =>
    voice.utterance({
      sessionId: session.sessionId,
      source: "user",
      transcript,
    });
  return { ...ctx, service, voice, proposal, session, say };
}
describe("deterministic browser voice approval", () => {
  it("holds a small feasible order until two separate explicit human utterances", async () => {
    const c = await fixture();
    expect(c.proposal.status).toBe("held");
    expect(c.proposal.orderId).toBeUndefined();
    expect(
      c.proposal.verdict.firedRules.some(
        (r) => r.code === "HUMAN_APPROVAL_REQUIRED",
      ),
    ).toBe(true);
    expect((await c.say("I approve this quotation.")).status).toBe(
      "confirmation_required",
    );
    expect((await c.service.snapshot()).orders).toHaveLength(0);
    const result = await c.say("Confirm approval!");
    expect(result).toMatchObject({
      status: "decided",
      approval: { status: "approved", channel: "voice" },
      proposal: { status: "placed" },
    });
    expect((await c.service.snapshot()).orders).toHaveLength(1);
    expect(await c.service.verifyLedger()).toMatchObject({ valid: true });
    await expect(c.say("confirm approval")).rejects.toMatchObject({
      code: "VOICE_SESSION_EXPIRED",
    });
  });
  it.each([
    "I approve this quotation?",
    "I do not approve this quotation",
    "If it arrives tomorrow, I approve this quotation",
    "Say I approve this quotation",
    '"I approve this quotation"',
    "I approve this quotation and confirm approval",
  ])("does not interpret %s as consent", (text) => {
    expect(spokenCommand(text)).toBeUndefined();
  });
  it("never treats an agent message, a naked confirmation, or a question between turns as consent", async () => {
    const c = await fixture();
    await expect(
      c.voice.utterance({
        sessionId: c.session.sessionId,
        source: "ai",
        transcript: "I approve this quotation",
      }),
    ).rejects.toThrow();
    expect((await c.say("confirm approval")).status).toBe("listening");
    await c.say("I approve this quotation");
    await c.say("What is the delivery date?");
    expect((await c.say("confirm approval")).status).toBe("listening");
    expect((await c.service.snapshot()).orders).toHaveLength(0);
  });
  it.each([
    ["Yeah, whatever, just reject it.", "Yeah, cancel it.", "rejected"],
    ["No, don't approve it.", "Yes, please.", "rejected"],
    ["Cancel it please", "Please do", "rejected"],
    ["Go ahead and place the order", "Yeah, go ahead", "approved"],
    ["Approve it", "Sounds good", "approved"],
  ])(
    "accepts natural request %s followed by %s",
    async (request, confirmation, status) => {
      const c = await fixture();
      expect((await c.say(request)).status).toBe("confirmation_required");
      expect((await c.service.snapshot()).orders).toHaveLength(0);
      expect(await c.say(confirmation)).toMatchObject({
        status: "decided",
        approval: { status },
      });
    },
  );
  it("does not commit a bare yes, a changed decision, a condition or a negated confirmation", async () => {
    const c = await fixture();
    expect((await c.say("yes")).status).toBe("listening");
    await c.say("approve it");
    expect((await c.say("yes, but only if it arrives tomorrow")).status).toBe(
      "listening",
    );
    await c.say("approve it");
    expect(await c.say("no, cancel it")).toMatchObject({
      status: "confirmation_required",
      decision: "reject",
    });
    expect((await c.say("don't cancel it")).status).toBe("listening");
    expect((await c.service.snapshot()).orders).toHaveLength(0);
  });
  it("lets the model propose intent without authorizing an order", async () => {
    const c = await fixture();
    await c.say("Let's give that refill the green light");
    expect(
      c.voice.prepare({ sessionId: c.session.sessionId, decision: "approve" }),
    ).toMatchObject({ status: "confirmation_required" });
    expect((await c.service.snapshot()).orders).toHaveLength(0);
    expect(await c.say("yes please")).toMatchObject({
      status: "decided",
      approval: { status: "approved" },
    });
  });
  it("refuses model proposals without recent speech, with conditions, or contradicting a clear request", async () => {
    const c = await fixture();
    const prepare = () =>
      c.voice.prepare({ sessionId: c.session.sessionId, decision: "approve" });
    expect(prepare().status).toBe("listening");
    await c.say("Only if the price comes down");
    expect(prepare().status).toBe("listening");
    await c.say("No, don't approve it");
    expect(prepare().status).toBe("listening");
    await c.say("yes");
    // The pending rejection, not the model's opposite suggestion, is authoritative.
    expect((await c.service.snapshot()).orders).toHaveLength(0);
  });
  it("records rejection without placing an order", async () => {
    const c = await fixture();
    await c.say("I reject this quotation");
    const result = await c.say("confirm rejection");
    expect(result).toMatchObject({
      status: "decided",
      approval: { status: "rejected", channel: "voice" },
    });
    expect((await c.service.snapshot()).orders).toHaveLength(0);
  });
  it("expires confirmations, expires sessions, and invalidates ended sessions", async () => {
    const c = await fixture();
    await c.say("I approve this quotation");
    c.setTime(new Date(now.getTime() + 31_000));
    expect((await c.say("confirm approval")).status).toBe("listening");
    c.setTime(new Date(now.getTime() + 301_000));
    await expect(c.say("I approve this quotation")).rejects.toMatchObject({
      code: "VOICE_SESSION_EXPIRED",
    });
    const session = await c.voice.start(c.proposal.approvalId!);
    c.voice.end(session.sessionId);
    await expect(
      c.voice.utterance({
        sessionId: session.sessionId,
        source: "user",
        transcript: "confirm approval",
      }),
    ).rejects.toMatchObject({ code: "VOICE_SESSION_EXPIRED" });
    expect((await c.service.snapshot()).orders).toHaveLength(0);
  });
  it("rejects stale revisions and cannot override stock constraints", async () => {
    const c = await fixture();
    await c.service.db.transaction((repo) =>
      repo.put("proposals", { ...c.proposal, revision: 2 }),
    );
    await c.say("I approve this quotation");
    await expect(c.say("confirm approval")).rejects.toMatchObject({
      code: "STALE_DECISION",
    });
    const { offers } = await c.service.getOffers(c.agent, {
      productIds: ["461885"],
      requestedDate: delivery,
    });
    const short = await c.service.submit(c.agent, input(offers[0]!, 150));
    const session = await c.voice.start(short.approvalId!);
    const say = (transcript: string) =>
      c.voice.utterance({
        sessionId: session.sessionId,
        source: "user",
        transcript,
      });
    await say("I approve this quotation");
    await expect(say("confirm approval")).rejects.toMatchObject({
      code: "REVALIDATION_REQUIRED",
    });
    expect((await c.service.snapshot()).orders).toHaveLength(0);
  });
  it("handles simultaneous confirmations at most once and invalidates an old connection", async () => {
    const c = await fixture();
    const session = await c.voice.start(c.proposal.approvalId!);
    await expect(c.say("I approve this quotation")).rejects.toMatchObject({
      code: "VOICE_SESSION_EXPIRED",
    });
    const say = (transcript: string) =>
      c.voice.utterance({
        sessionId: session.sessionId,
        source: "user",
        transcript,
      });
    await say("I approve this quotation");
    const results = await Promise.allSettled([
      say("confirm approval"),
      say("confirm approval"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await c.service.snapshot()).orders).toHaveLength(1);
  });
  it("protects voice endpoints from buyers, missing auth, hostile origins and production mode", async () => {
    const c = await fixture();
    const app = createApp(c.service, testConfig, c.voice);
    const body = JSON.stringify({ approvalId: c.proposal.approvalId });
    for (const authorization of ["", "Bearer test-buyer"]) {
      expect(
        (
          await app.request("/admin/voice/start", {
            method: "POST",
            headers: { authorization, "Content-Type": "application/json" },
            body,
          })
        ).status,
      ).toBe(401);
    }
    expect(
      (
        await app.request("/admin/voice/start", {
          method: "POST",
          headers: {
            authorization: "Bearer test-admin",
            origin: "https://evil.example",
            "Content-Type": "application/json",
          },
          body,
        })
      ).status,
    ).toBe(403);
    const disabled = createApp(
      c.service,
      { ...testConfig, demo: false },
      c.voice,
    );
    expect(
      (
        await disabled.request("/admin/voice/start", {
          method: "POST",
          headers: {
            authorization: "Bearer test-admin",
            "Content-Type": "application/json",
          },
          body,
        })
      ).status,
    ).toBe(403);
  });
  it("builds the four requested categories and retries a quote without creating another", async () => {
    const c = await fixture();
    const id = randomUUID();
    const first = await runPurchaseDemo(c.service, id);
    const again = await runPurchaseDemo(c.service, id);
    expect(first.proposal.id).toBe(again.proposal.id);
    expect(first.proposal.status).toBe("held");
    expect(first.proposal.lines.map((l) => l.productId)).toEqual([
      "464201",
      "475797",
      "476812",
      "460428",
    ]);
    expect(
      first.proposal.verdict.firedRules.filter((r) => r.severity === "REFUSE"),
    ).toHaveLength(0);
  });
});
