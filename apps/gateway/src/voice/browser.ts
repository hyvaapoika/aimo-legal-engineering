import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  DomainError,
  type Approval,
  type Proposal,
  type Offer,
} from "@aimo/schema";
import { canonical, sha256 } from "@aimo/signing";
import { lineCents } from "@aimo/feasibility";
import { DEMO_CUSTOMER, type GatewayService } from "../service.js";
import { elevenLabsClient } from "./elevenlabs.js";

const lifetime = 5 * 60_000;
const confirmationWindow = 30_000;
const uncertain =
  /\b(if|unless|maybe|perhaps|might|could|would|but|except|until|provided|suppose|assuming)\b/i;
export const prepareSchema = z
  .object({
    sessionId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
  })
  .strict();
export const utteranceSchema = z
  .object({
    sessionId: z.string().uuid(),
    source: z.literal("user"),
    transcript: z.string().min(1).max(2000),
  })
  .strict();

// A conservative conversational grammar, not a phrase the person must recite.
// The model can explain intent and ask questions, but cannot manufacture consent.
// Unrecognized or conditional speech leaves the quotation pending.
export function spokenCommand(text: string) {
  if (/[?"“”]/.test(text)) return undefined;
  let normalized = text
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[,.!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /\b(if|unless|maybe|perhaps|might|could|would|but|except|until|provided|suppose|assuming)\b/.test(
      normalized,
    )
  )
    return undefined;
  if (normalized === "confirm approval") return "confirm_approve" as const;
  if (normalized === "confirm rejection") return "confirm_reject" as const;
  if (
    /^(yes|yeah|yep|yup|sure|okay|ok|absolutely|correct|that's right|that is right|go ahead|do it|please do|sounds good|that's fine)( (yes|yeah|sure|okay|ok|please|go ahead|do it|please do|that's right|thanks|thank you))*$/.test(
      normalized,
    )
  )
    return "confirm" as const;
  // Conversational fillers never alter the requested action.
  normalized = normalized
    .replace(
      /^(?:(?:yeah|yes|yep|okay|ok|no|nah|nope|well|actually|whatever|just|please|thanks|thank you) )+/,
      "",
    )
    .replace(/ (?:please|thanks|thank you)$/, "");
  if (
    /^(?:don't|do not) (?:approve|place|order|buy)(?: (?:it|that|this|the order|this order|the quotation|this quotation))?$/.test(
      normalized,
    )
  )
    return "reject" as const;
  const object =
    "(?:it|that|this|(?:the |this |that )?(?:quotation|quote|order|purchase))";
  const subject =
    "(?:(?:i |i want to |i'd like to |let's |let us |go ahead and |you can )?)";
  if (
    new RegExp(
      "^" + subject + "(?:reject|cancel|decline|scrap)(?: " + object + ")?$",
    ).test(normalized)
  )
    return "reject" as const;
  if (
    new RegExp(
      "^" + subject + "(?:approve|place|order|buy)(?: " + object + ")?$",
    ).test(normalized)
  )
    return "approve" as const;
  return undefined;
}

type Session = {
  id: string;
  approvalId: string;
  challengeToken: string;
  revision: number;
  lineHash: string;
  expiresAt: number;
  totalEUR: string;
  lastUser?: { text: string; at: number };
  pending?: { decision: "approve" | "reject"; at: number; transcript: string };
};
export class BrowserVoice {
  private sessions = new Map<string, Session>();
  constructor(
    private service: GatewayService,
    private issueToken: () => Promise<string>,
  ) {}
  async start(approvalId: string) {
    const now = this.service.now().getTime();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now || session.approvalId === approvalId)
        this.sessions.delete(id);
    }
    if (this.sessions.size >= 10)
      throw new DomainError(
        "VOICE_LIMIT",
        "End an existing voice session first.",
        429,
      );
    const details = await this.service.db.transaction(async (repo) => {
      const approval = await repo.get<Approval>("approvals", approvalId);
      if (!approval || approval.customerId !== DEMO_CUSTOMER)
        throw new DomainError("NOT_FOUND", "Approval not found.", 404);
      if (
        approval.status !== "pending" ||
        Date.parse(approval.expiresAt) <= now
      )
        throw new DomainError(
          "APPROVAL_CLOSED",
          "This quotation is no longer awaiting approval.",
          409,
        );
      const proposal = (await repo.get<Proposal>(
        "proposals",
        approval.proposalId,
      ))!;
      const lines = await Promise.all(
        proposal.lines.map(async (line) => {
          const offer = (await repo.get<Offer>("offers", line.offerId))!;
          return {
            name: offer.product.names.en || offer.product.names.fi,
            quantity: line.qty,
            salesUnit: line.salesUnit,
            unitPriceEUR: offer.price?.value,
            lineTotalEUR: lineCents(line.qty, offer.price?.value ?? 0) / 100,
            allergens: offer.product.allergens,
            allergenFree: offer.product.allergenFree,
            offerExpiresAt: offer.validUntil,
          };
        }),
      );
      return {
        approval,
        proposal,
        context: {
          quotationId: proposal.id,
          revision: proposal.revision,
          totalEUR: proposal.totalCents / 100,
          currency: "EUR",
          tax: "excluding VAT",
          deliveryDate: proposal.requestedDate,
          simulated: true,
          lines,
          reviewReasons: proposal.verdict.firedRules.map((r) => r.message),
        },
      };
    });
    let conversationToken: string;
    try {
      conversationToken = await this.issueToken();
    } catch {
      throw new DomainError(
        "VOICE_UNAVAILABLE",
        "ElevenLabs could not start a voice session. Check the API key, agent access and remaining credits, then retry.",
        503,
      );
    }
    const session: Session = {
      id: randomUUID(),
      approvalId,
      challengeToken: details.approval.challengeToken,
      revision: details.proposal.revision,
      lineHash: details.approval.lineHash,
      totalEUR: (details.proposal.totalCents / 100).toFixed(2),
      expiresAt: Math.min(
        now + lifetime,
        Date.parse(details.approval.expiresAt),
      ),
    };
    this.sessions.set(session.id, session);
    await this.service.audit("voice.session_created", DEMO_CUSTOMER, "maija", {
      approvalId,
      sessionId: session.id,
      transport: "browser_webrtc",
    });
    return {
      sessionId: session.id,
      conversationToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
      quotationContext: JSON.stringify(details.context),
    };
  }
  end(sessionId: string) {
    this.sessions.delete(sessionId);
  }
  private question(session: Session, decision: "approve" | "reject") {
    return {
      status: "confirmation_required" as const,
      decision,
      message:
        decision === "approve"
          ? `Shall I place this simulated order for €${session.totalEUR}, excluding VAT?`
          : "Shall I cancel this quotation? No order will be placed.",
    };
  }
  // Advisory model intent can only prepare a question, never commit a decision.
  prepare(raw: unknown) {
    const { sessionId, decision } = prepareSchema.parse(raw);
    const session = this.sessions.get(sessionId);
    const now = this.service.now().getTime();
    if (!session || session.expiresAt <= now)
      throw new DomainError(
        "VOICE_SESSION_EXPIRED",
        "Reconnect to review this quotation again.",
        409,
      );
    const speech = session.lastUser;
    if (
      !speech ||
      now - speech.at > confirmationWindow ||
      /[?]/.test(speech.text) ||
      uncertain.test(speech.text)
    )
      return {
        status: "listening" as const,
        message:
          "Ask a normal clarification. Conditional or unclear speech is not a decision.",
      };
    const literal = spokenCommand(speech.text);
    if ((literal === "approve" || literal === "reject") && literal !== decision)
      return {
        status: "listening" as const,
        message:
          "The proposed action contradicts the human's request. Clarify; do not act.",
      };
    if (
      literal === "confirm" ||
      literal === "confirm_approve" ||
      literal === "confirm_reject"
    )
      return {
        status: "listening" as const,
        message: "A standalone confirmation cannot start a new decision.",
      };
    session.pending = { decision, at: now, transcript: speech.text };
    return this.question(session, decision);
  }
  async utterance(raw: unknown) {
    const input = utteranceSchema.parse(raw);
    const session = this.sessions.get(input.sessionId);
    const now = this.service.now().getTime();
    if (!session || session.expiresAt <= now) {
      this.sessions.delete(input.sessionId);
      throw new DomainError(
        "VOICE_SESSION_EXPIRED",
        "Reconnect to review this quotation again.",
        409,
      );
    }
    session.lastUser = { text: input.transcript, at: now };
    const command = spokenCommand(input.transcript);
    const pending = session.pending;
    const confirmation =
      pending &&
      now - pending.at <= confirmationWindow &&
      (command === "confirm" ||
        command === pending.decision ||
        command === `confirm_${pending.decision}`);
    if (!confirmation && (command === "approve" || command === "reject")) {
      session.pending = {
        decision: command,
        at: now,
        transcript: input.transcript,
      };
      return this.question(session, command);
    }
    session.pending = undefined; // Questions/uncertainty cancel confirmation; never guess.
    if (!confirmation || !pending) return { status: "listening" as const };
    // Consume before awaiting: concurrent confirmations cannot submit twice.
    this.sessions.delete(session.id);
    const current = await this.service.db.transaction((repo) =>
      repo.get<Approval>("approvals", session.approvalId),
    );
    if (!current || current.lineHash !== session.lineHash)
      throw new DomainError(
        "STALE_DECISION",
        "The quotation changed. Reconnect to review it.",
        409,
      );
    const result = await this.service.decide(
      session.approvalId,
      {
        decision: pending.decision,
        challengeToken: session.challengeToken,
        revision: session.revision,
      },
      "maija",
      DEMO_CUSTOMER,
      {
        sessionId: session.id,
        transcriptHash: sha256(
          canonical([pending.transcript, input.transcript]),
        ),
      },
    );
    return {
      status: "decided" as const,
      decision: pending.decision,
      proposal: result.proposal,
      approval: result.approval,
    };
  }
}

export function browserVoice(service: GatewayService, stateDir: string) {
  return new BrowserVoice(service, async () => {
    const { agentId } = z
      .object({ agentId: z.string().min(1) })
      .parse(
        JSON.parse(
          await readFile(join(stateDir, "elevenlabs-agent.json"), "utf8"),
        ),
      );
    const response =
      await elevenLabsClient().conversationalAi.conversations.getWebrtcToken({
        agentId,
      });
    return response.token;
  });
}
