# Live voice approval: researched integration plan

Status: researched, not implemented or call-tested. Existing voice support remains disabled. This document records the user's new requirements; it does not claim that the current application meets them.

## Confirmed product requirements

- Every quotation submitted for purchase in the demo needs human approval, including purchases within existing spending limits. Feasibility checks and hard refusals remain in force.
- The restaurant agent detects low inventory and requests milk, butter, yoghurt, and peanuts with explicit quantities and delivery requirements.
- The supplier gateway builds the quotation, calls the registered restaurant approver, answers questions, requests explicit confirmation, and creates the simulated order only after approval.
- The dashboard shows actual progress through request, lookup, quotation, approval call, decision, and order creation.
- Increase text size, reduce explanatory copy, replace the current editorial/serif appearance with a clear operational interface, and make the live flow the primary screen.

## Recommended first integration

Use ElevenLabs Agents for conversational voice and its native Twilio integration for the telephone connection. This is an engineering recommendation based on the documented integration, not a verified account setup or latency claim.

ElevenLabs supports outbound calls using either a purchased Twilio number or a verified Twilio caller ID. A purchased number is not universally mandatory. Caller availability, destination permissions, trial limitations, and account capability must be checked before selecting the caller identity. [Native integration](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration/).

An outbound request supplies an agent ID, imported phone-number ID, destination number, and per-conversation context; the response supplies conversation ID and Twilio Call SID. Store these against one approval attempt. [Outbound API](https://elevenlabs.io/docs/eleven-agents/api-reference/integrations/twilio/outbound-call).

Twilio is optional as a provider: ElevenLabs also documents SIP trunk integration, including outbound calls through another carrier. That adds carrier configuration and is not automatically easier for this project. [SIP integration](https://elevenlabs.io/docs/eleven-agents/phone-numbers/sip-trunking).

A browser voice session requires no telephone carrier and is useful for the first conversation test and a clearly labelled fallback. It does not ring a mobile number. [React voice SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react).

Use a model available in the ElevenLabs agent configuration for the initial spike. Gemini is supported through that platform; a custom model endpoint is optional and adds another dependency. Measure conversational latency and tool accuracy before choosing the final model. [Supported models](https://elevenlabs.io/docs/eleven-agents/customization/llm).

## Approval protocol to implement

1. Persist a quotation and proposal; require human approval through server-side policy, independent of order amount.
2. Freeze a quotation revision containing item quantities, substitutions, delivery date, currency, tax treatment, total, and expiry. Persist a call attempt before invoking any provider.
3. Dial only the registered demo approver. Pass quotation context and a short-lived capability restricted to this approval attempt; never expose the general admin token to the voice agent.
4. Identify the assistant as an AI purchasing assistant. Verify the approver using the selected demo verification method. If a PIN is used, validate it on the server and do not include the expected PIN in the model context or logs.
5. Give the exact quotation summary and answer questions using read-only quotation data. Missing information stays unknown.
6. Ask explicitly whether the person approves that quotation and amount. Use an authenticated server tool to record approval or rejection during the call. Post-call sentiment or a general conversation-success label is not authority to purchase.
7. Verify the call/approval binding, unconsumed confirmation capability, quotation revision, pending state, expiry, mandate, and current feasibility. Commit the decision and simulated order transactionally. Duplicate delivery must return the same outcome, not create another order.
8. Tell the caller that an order is confirmed only after the server returns success. A changed price, item, or quantity requires a new quotation and confirmation. Unanswered calls, voicemail, ambiguity, or disconnected calls leave the purchase unapproved.

ElevenLabs supports authenticated webhook tools during conversations. Tool authentication is configured separately from signed post-call event delivery. [Webhook tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/webhook-tools). Post-call webhooks provide transcripts and failure information and support HMAC verification; use them for audit/reconciliation, not as the only approval trigger. [Post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks).

Provider tools and webhooks need a reachable HTTPS endpoint. Before exposing anything, replace local demo credentials and restrict the public surface to the required authenticated callbacks; do not expose the permissive local demo login. An HTTPS tunnel or a deployed callback service is a setup requirement, not something already configured.

## Live progress UI

Use a persisted run ID and event history, streamed or polled by the authenticated dashboard:

`Inventory shortage → Catalogue lookup → Quotation ready → Awaiting approval → Dialling → Call in progress → Explicit decision → Revalidation → Order confirmed`

Rejection, call failure, no answer, quotation expiry, and revision are visible branches. An order can become confirmed while the agent is still announcing it; call lifecycle and purchase lifecycle are separate state machines.

Twilio provides initiated/ringing/answered/completed callbacks. Calls can also be fetched by Call SID, but the read API is eventually consistent. The native ElevenLabs outbound endpoint does not document a custom Twilio status-callback argument, so do not assume one exists. Start with provider status polling plus actual approval-tool events; if immediate callback delivery is required, use Twilio-owned call creation and ElevenLabs register-call routing. [Call status API](https://www.twilio.com/docs/voice/api/call-resource), [Register-call integration](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/register-call).

ElevenLabs' separate live conversation monitoring WebSocket is documented as enterprise-only. The progress graph must work without it. Do not promise a live phone transcript or word-by-word speaking indicators on an unverified account tier. [Real-time monitoring](https://elevenlabs.io/docs/eleven-agents/guides/realtime-monitoring).

UI direction: 16–18px primary text; readable status labels; sans-serif headings; fewer paragraphs; central flow graph; selected-step details; prominent quotation total and call status; raw protocol/audit details behind an expandable panel. Replace “Run purchase demo” with a start action that creates one tracked run rather than instantly populating unrelated scenarios. No timer-driven simulated success states in the live mode.

## Test gates before presenting

1. Account preflight: ElevenLabs Agents access and credits; usable caller identity; destination country permissions; actual account trial restrictions; reachable authenticated callback URL.
2. Browser conversation: correct items, quantities, tax description, delivery date, total, interruption handling, and questions; no approval on ambiguous speech.
3. One actual outbound phone call to the user's registered test number: rings, answers, two-way conversation, correct quotation context.
4. Spoken approval: exactly one order, with confirmation returned during the call and UI updated from server state.
5. Rejection and hangup: no order. Busy/no-answer: clear failure, no automatic repeated dialling.
6. Trust tests: wrong PIN, expired/revised quotation, forged or duplicated provider requests, duplicate start clicks, and concurrent app/phone decisions.
7. Full rehearsal: restaurant inventory trigger → catalogue → hosted Valio lookup → quotation → phone approval → simulated order, with visible progress throughout.

Current local state: no ElevenLabs key/agent/phone-number ID or Twilio credentials are configured. No voice test has been performed. Country/account details and language/verification preferences were requested from the user. Twilio's current trial guide limits verified destinations and custom call behavior; do not assume a trial can run this integration. [Voice trial guide](https://www.twilio.com/docs/usage/trials/try-out-voice).
