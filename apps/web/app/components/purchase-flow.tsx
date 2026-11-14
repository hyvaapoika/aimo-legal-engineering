"use client";
import { useEffect, useRef, useState } from "react";
import type { Conversation as VoiceConversation } from "@elevenlabs/client";
import type { Proposal, Product } from "@aimo/schema";
import {
  ArrowRight,
  Check,
  Mic,
  PhoneOff,
  RotateCcw,
  Volume2,
} from "lucide-react";
import { api, money, day, count, type Snapshot } from "./shared";

type VoiceStart = {
  sessionId: string;
  conversationToken: string;
  quotationContext: string;
  expiresAt: string;
};
type VoiceResult = {
  status: "listening" | "confirmation_required" | "decided";
  message?: string;
  decision?: string;
  proposal?: Proposal;
};
type Message = { role: "user" | "agent" | "system"; text: string };
const steps = [
  "Inventory low",
  "Catalog matched",
  "Quotation ready",
  "Human approval",
  "Simulated order",
];

export function PurchaseFlow({
  snapshot,
  products,
  refresh,
  runSignal,
}: {
  snapshot?: Snapshot;
  products: Record<string, Product>;
  refresh: () => Promise<void>;
  runSignal: number;
}) {
  const [proposalId, setProposalId] = useState<string>();
  const [phase, setPhase] = useState<"idle" | "catalog" | "quote" | "ready">(
    "idle",
  );
  const [localProposal, setLocalProposal] = useState<Proposal>();
  const [status, setStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [mode, setMode] = useState("listening");
  const [messages, setMessages] = useState<Message[]>([]);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const conversation = useRef<VoiceConversation | null>(null);
  const voiceSession = useRef<string | null>(null);
  const generation = useRef(0);
  const processing = useRef(Promise.resolve());
  const decisionStatus = useRef<Record<string, unknown>>({
    status: "listening",
  });
  const running = useRef(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const peerChannel = useRef<BroadcastChannel | null>(null);
  const endRef = useRef<() => Promise<void>>(async () => {});
  const proposal =
    snapshot?.proposals.find((p) => p.id === proposalId) ?? localProposal;
  const resolved =
    proposal?.status === "placed" ||
    proposal?.status === "rejected" ||
    proposal?.status === "amended";
  useEffect(() => {
    const peer =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("aimo-voice");
    peerChannel.current = peer;
    if (peer)
      peer.onmessage = () => {
        void endRef.current();
      };
    const saved = localStorage.getItem("aimo.purchase-flow");
    if (saved) {
      setProposalId(saved);
      setPhase("ready");
    }
    return () => {
      peer?.close();
      peerChannel.current = null;
      generation.current++;
      void conversation.current?.endSession();
      if (voiceSession.current)
        void api("voice/end", { sessionId: voiceSession.current }).catch(
          () => {},
        );
    };
  }, []);
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [messages]);
  async function end() {
    generation.current++;
    const current = conversation.current;
    conversation.current = null;
    const sessionId = voiceSession.current;
    voiceSession.current = null;
    setStatus("disconnected");
    if (sessionId) await api("voice/end", { sessionId }).catch(() => {});
    await current?.endSession();
  }
  endRef.current = end;
  async function run() {
    if (running.current || status !== "disconnected") return;
    running.current = true;
    setError("");
    setHint("");
    setMessages([]);
    setLocalProposal(undefined);
    setProposalId(undefined);
    localStorage.removeItem("aimo.purchase-flow");
    setPhase("catalog");
    try {
      await Promise.all(
        ["milk", "butter", "yoghurt", "peanuts"].map((query) =>
          api(`catalog/search?query=${query}`),
        ),
      );
      setPhase("quote");
      const result = await api<{ proposal: Proposal }>("demo/purchase", {
        idempotencyKey: crypto.randomUUID(),
      });
      setLocalProposal(result.proposal);
      setProposalId(result.proposal.id);
      localStorage.setItem("aimo.purchase-flow", result.proposal.id);
      setPhase("ready");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
    } finally {
      running.current = false;
    }
  }
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (runSignal > 0) void runRef.current();
  }, [runSignal]);

  async function startVoice() {
    if (!proposal?.approvalId || status !== "disconnected") return;
    peerChannel.current?.postMessage("starting");
    const attempt = ++generation.current;
    setStatus("connecting");
    setError("");
    setHint("");
    setMessages([]);
    const seen = new Set<number>();
    processing.current = Promise.resolve();
    decisionStatus.current = { status: "listening" };
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Microphone access needs HTTPS or localhost. Open this app on the computer at localhost:3100, or use a trusted HTTPS address on your phone.",
        );
      // Request permission in the click gesture, release this stream; the SDK owns its own mic.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      if (generation.current !== attempt) return;
      const session = await api<VoiceStart>("voice/start", {
        approvalId: proposal.approvalId,
      });
      if (generation.current !== attempt) {
        await api("voice/end", { sessionId: session.sessionId });
        return;
      }
      voiceSession.current = session.sessionId;
      const { Conversation } = await import("@elevenlabs/client");
      const active = await Conversation.startSession({
        conversationToken: session.conversationToken,
        connectionType: "webrtc",
        dynamicVariables: { quotation_context: session.quotationContext },
        clientTools: {
          prepare_decision_confirmation: async (parameters: {
            decision?: unknown;
          }) => {
            await processing.current;
            if (
              generation.current !== attempt ||
              voiceSession.current !== session.sessionId
            )
              return JSON.stringify({
                status: "error",
                message: "No active decision session.",
              });
            try {
              const result = await api<VoiceResult>("voice/prepare", {
                sessionId: session.sessionId,
                decision: parameters.decision,
              });
              decisionStatus.current = {
                status: result.status,
                decision: result.decision,
                message: result.message,
              };
              setHint(result.message || "");
              return JSON.stringify(decisionStatus.current);
            } catch {
              return JSON.stringify({
                status: "error",
                message:
                  "Confirmation could not be prepared; no decision was saved.",
              });
            }
          },
          get_decision_status: async () => {
            await processing.current;
            return JSON.stringify(decisionStatus.current);
          },
        },
        onConnect: () => {
          if (generation.current === attempt) setStatus("connected");
        },
        onDisconnect: (details) => {
          if (generation.current !== attempt) return;
          setStatus("disconnected");
          conversation.current = null;
          voiceSession.current = null;
          if (details.reason === "error")
            setError(
              "The voice provider ended the connection. Another tab may already have an active call, or the account may be at its usage limit. End other calls and retry.",
            );
          generation.current++;
          void api("voice/end", { sessionId: session.sessionId }).catch(
            () => {},
          );
        },
        onError: () => {
          if (generation.current === attempt) {
            setError(
              "The voice connection failed. Your quotation remains unchanged; reconnect to try again.",
            );
            void end();
          }
        },
        onModeChange: ({ mode }) => {
          if (generation.current === attempt) setMode(mode);
        },
        onMessage: ({ role, message, event_id }) => {
          if (generation.current !== attempt) return;
          setMessages((prev) => [
            ...prev.slice(-79),
            { role: role === "user" ? "user" : "agent", text: message },
          ]);
          if (role !== "user" || seen.has(event_id)) return;
          seen.add(event_id);
          // Serialize final user transcripts. Never process AI messages or tentative ASR events.
          processing.current = processing.current
            .then(async () => {
              if (
                generation.current !== attempt ||
                voiceSession.current !== session.sessionId
              )
                return;
              const result = await api<VoiceResult>("voice/utterance", {
                sessionId: session.sessionId,
                source: "user",
                transcript: message,
              });
              if (generation.current !== attempt) return;
              decisionStatus.current = {
                status: result.status,
                decision: result.decision,
                message: result.message,
              };
              if (result.status === "confirmation_required") {
                setHint(result.message!);
                conversation.current?.sendContextualUpdate(
                  `Gateway status: confirmation required. ${result.message}`,
                );
              } else if (result.status === "decided") {
                voiceSession.current = null;
                setLocalProposal(result.proposal);
                const resultText =
                  result.decision === "approve"
                    ? "Approval recorded. The simulated order has been placed. No real purchase was made."
                    : "Rejection recorded. No order was placed.";
                decisionStatus.current = {
                  status: "decided",
                  decision: result.decision,
                  message: resultText,
                };
                setHint(resultText);
                setMessages((prev) => [
                  ...prev,
                  { role: "system", text: resultText },
                ]);
                conversation.current?.sendContextualUpdate(
                  `Gateway status, authoritative: ${resultText}`,
                );
                await refresh();
              } else setHint("");
            })
            .catch((e: Error) => {
              decisionStatus.current = {
                status: "error",
                message: "Decision not recorded. Check the app and reconnect.",
              };
              setError(e.message);
              conversation.current?.sendContextualUpdate(
                "Gateway status: decision was NOT recorded. Ask the user to check the screen and reconnect.",
              );
              void refresh();
            });
        },
      });
      if (generation.current !== attempt) {
        await active.endSession();
        return;
      }
      active.setVolume({ volume: 1 });
      conversation.current = active;
    } catch (e) {
      if (generation.current !== attempt) return;
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone access was declined. Allow it in your browser, then try again."
          : (e as Error).message,
      );
      await end();
    }
  }
  const busy = phase === "catalog" || phase === "quote";
  const progress =
    phase === "idle"
      ? -1
      : phase === "catalog"
        ? 0
        : phase === "quote"
          ? 1
          : proposal?.status === "placed"
            ? 4
            : 2;
  return (
    <section className="purchase-flow" aria-label="Live purchase demo">
      <div className="flow-heading">
        <div>
          <span className="eyebrow">LIVE PURCHASE DEMO</span>
          <h2>From low stock to an approved order</h2>
        </div>
        <span className="flow-pill">Human approval on every quote</span>
      </div>
      <ol className="flow-graph" aria-label="Purchase progress">
        {steps.map((step, index) => {
          const active =
            (index === progress + 1 && phase !== "idle" && !resolved) ||
            (index === 3 && status === "connected" && !resolved);
          const done = index <= progress;
          return (
            <li
              key={step}
              className={`${done ? "done" : ""} ${active ? "active" : ""}`}
              aria-current={active ? "step" : undefined}
            >
              <span className="flow-node">
                {done ? <Check size={20} /> : index + 1}
              </span>
              <strong>{step}</strong>
              <small>
                {index === 3 && proposal?.status === "rejected"
                  ? "Rejected"
                  : index === 4 && proposal?.status === "rejected"
                    ? "Not placed"
                    : index === 3 && status === "connected" && !resolved
                      ? "Call in progress"
                      : done
                        ? "Complete"
                        : active
                          ? index === 3
                            ? "Waiting for you"
                            : "In progress"
                          : "Waiting"}
              </small>
            </li>
          );
        })}
      </ol>
      {phase === "idle" && (
        <div className="flow-intro">
          <div>
            <h3>The kitchen needs a refill.</h3>
            <p>24 L milk · 2 kg butter · 6 kg yoghurt · 3 kg peanuts</p>
          </div>
          <button className="primary" onClick={() => void run()}>
            Start purchase demo <ArrowRight size={18} />
          </button>
        </div>
      )}
      {busy && (
        <p role="status" className="flow-working">
          {phase === "catalog"
            ? "The buyer is matching products in the supplier catalog…"
            : "The gateway is checking offers and preparing your quotation…"}
        </p>
      )}
      {proposal && !busy && (
        <div className="flow-details">
          <div className="flow-quote">
            <span className="eyebrow">YOUR QUOTATION</span>
            <h3>
              {money(proposal.totalCents)}{" "}
              <small>excluding VAT · simulated prices</small>
            </h3>
            <p>Delivery requested: {day(proposal.requestedDate)}</p>
            <ul>
              {proposal.lines.map((line) => (
                <li key={line.productId}>
                  <span>
                    {products[line.productId]?.names.en ??
                      products[line.productId]?.names.fi ??
                      line.productId}
                  </span>
                  <strong>
                    {count(line.qty)} {line.salesUnit}
                  </strong>
                </li>
              ))}
            </ul>
            <p className="flow-note">
              Contains peanut products. Supplier allergen declarations remain
              authoritative.
            </p>
            {proposal.verdict.firedRules
              .filter((r) => r.code !== "HUMAN_APPROVAL_REQUIRED")
              .map((r) => (
                <p className="flow-note" key={r.id + r.productId}>
                  {r.message}
                </p>
              ))}
            {proposal.orderId && (
              <p className="flow-success">
                Order {proposal.orderId.slice(0, 8)} recorded
              </p>
            )}
          </div>
          <div className="voice-panel">
            <div
              className={`voice-orb ${status === "connected" ? "live" : ""}`}
              aria-hidden="true"
            >
              {mode === "speaking" && status === "connected" ? (
                <Volume2 size={34} />
              ) : (
                <Mic size={34} />
              )}
            </div>
            <h3>
              {resolved
                ? proposal.status === "placed"
                  ? "Order approved"
                  : "Quotation closed"
                : status === "connected"
                  ? mode === "speaking"
                    ? "Aimo is speaking"
                    : "Aimo is listening"
                  : status === "connecting"
                    ? "Connecting to Aimo…"
                    : "Review it with Aimo"}
            </h3>
            <p>
              {resolved
                ? "Your decision is saved in the activity ledger."
                : "Ask about quantities, prices or delivery. Then decide by voice."}
            </p>
            {!resolved && status === "disconnected" && proposal.approvalId && (
              <button className="primary" onClick={() => void startVoice()}>
                <Mic size={19} /> Talk to Aimo
              </button>
            )}
            {status !== "disconnected" && (
              <button className="secondary" onClick={() => void end()}>
                <PhoneOff size={18} /> End conversation
              </button>
            )}
            {!resolved && (
              <p className="voice-phrase">
                Tell Aimo what you'd like to do. It will check with you once
                before saving your decision.
              </p>
            )}
            {hint && (
              <p role="status" className="voice-hint">
                {hint}
              </p>
            )}
            {status === "disconnected" && (
              <button className="text-button" onClick={() => void run()}>
                <RotateCcw size={15} /> Start a new quotation
              </button>
            )}
            <small>
              Live AI voice · English · up to 3 minutes · microphone required
            </small>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="banner error">
          {error}
        </p>
      )}
      {!!messages.length && (
        <div
          className="voice-transcript"
          aria-label="Conversation transcript"
          aria-live="polite"
        >
          {messages.map((m, i) => (
            <div className={`transcript-line ${m.role}`} key={i}>
              <strong>
                {m.role === "user"
                  ? "You"
                  : m.role === "agent"
                    ? "Aimo"
                    : "Gateway"}
              </strong>
              <span>{m.text}</span>
            </div>
          ))}
          <div ref={transcriptEnd} />
        </div>
      )}
      <div className="flow-footer">
        Browser voice conversation · no incoming telephone call · order
        placement is simulated
      </div>
    </section>
  );
}
