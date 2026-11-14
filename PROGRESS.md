# Implementation tracker

- [x] Inspect supplied plan, OpenAPI contract, and all four datasets.
- [x] Scaffold TypeScript workspace; preserve original source data and API contract.
- [x] Catalog ingestion, safe unit conversion, and live/mock Valio client.
- [x] Signed offers, agent identity, discovery, REST, and MCP.
- [x] Deterministic rules, transactional proposals, approvals, orders, and ledger.
- [x] Webshop screens and signed inventory-driven reference buyer.
- [x] Demo UBL XML export, published schemas, OpenAPI, and runbook.
- [x] Automated domain, cryptographic, lifecycle, MCP, and persistence verification.
- [x] Desktop and mobile browser verification of sign-in, approval, order detail, quantity amendment, catalog, mandate editor, and ledger verification.

Scope: local working hackathon application. Hosted provider checks and public deployment are recorded separately from local verification.

## Chef workspace design preview — 14 November 2026

- Built a new local homepage with a sample lunch, portion editing, product imagery, catalogue-selection search and category filters, contextual replacement cards, basket drawer, undo, saved lists, product details and draft export. The previous purchasing workspace remains at `/operations`.
- Real catalogue identities and declarations are paired with clearly labelled sample prices, availability and recipe quantities. The assistant is a guided UI preview, not a live language-model connection. New drafts do not submit purchasing proposals.
- Added regression coverage for whole-pack rounding, different pack sizes, integer money, dietary declaration preservation, manual quantity overrides, stable row order and safe local-storage restoration.
- Verification: `pnpm check` passed with 101 tests and the isolated purchasing demo; `pnpm build` passed. Browser checks covered replacement selection, portion scaling, basket totals, undo, saved lunches, product search and quantity editing. The 390 × 844 mobile layout had no horizontal overflow; the assistant opens as a side sheet. Desktop screenshot: `.local/chef-workspace-desktop.png` (ignored local artifact). Live AI and proposal submission are not connected to this preview.

## Verified on 14 November 2026

- `pnpm check`: strict TypeScript checks, **69 passing behavioral tests**, and the isolated end-to-end demo.
- `pnpm build`: production Next.js build passed.
- `pnpm test:postgres`: PostgreSQL 16 container passed AUTO/HOLD/REFUSE, concurrent approval, uniqueness, and ledger checks; disposable test schema and container cleaned up.
- `pnpm ingest`: all 17,546 catalog records indexed; 10,841 have known net content, including 3,535 explicitly inferred values.
- `pnpm demo`: 17,546 products; 13 signed offers; AUTO order, HOLD proposal, blocked-product REFUSE, human-approved order; ledger verified with 17 events.
- `pnpm buyer`: independently signed requests, JWS offer verification, inventory conversion, safe substitute selection, and a held proposal visible in the browser.
- Real MCP SDK client: initialized the HTTP transport, listed five tools, searched, obtained offers, submitted a proposal, and read the resulting order.
- Browser: approved the €4,042 replenishment request; order and ledger updated without reload. Changed fish from 150 KG to 100 KG; the new proposal required a separate policy approval before its €1,390 order was placed.
- Mobile: checked at 390 × 844; navigation, receipt layout, and responsive stats rendered without horizontal page overflow.
- Evidence: `.local/webshop-preview.jpg` and `.local/approved-order.jpg` (ignored local artifacts).
- Supplied challenge brief reviewed against all five judging criteria; see `docs/CHALLENGE-FIT.md`. Credentials removed from the repository copy.
- Valio hosted mock backend: supplied key saved only in ignored `.env`; `/api/ping`, `/api/price`, and `/api/availability` returned HTTP 200. The actual TypeScript adapter also passed ping and schema-validated lookup for product 464201, customer hotel-haven, delivery 2026-11-16. This is a lookup smoke test, not a hosted end-to-end purchasing rehearsal. Running app remains in local fixture mode.

## External and optional boundaries

- ElevenLabs CLI onboarding completed: key stored in ignored `.env.local`, official SDK installed, private English agent created and read back, and a short CLI text-to-speech test returned HTTP 200. Project TypeScript checks pass after SDK integration. This does not verify a conversational call or voice approval.
- Twilio template call reached the user's phone; they confirmed declining it. Provider status was `busy`, duration `0`. Trial documentation blocks streaming; a full ElevenLabs telephone agent is not verified on this account.

- Hosted Valio lookup is verified. The full signed offer → proposal → approval → order flow against that backend still needs rehearsal. No authentication bypass or mock fallback is used in hosted mode.
- Claude and Gemini adapters are implemented/typechecked; paid calls were not made without keys.
- Telephone/SMS integration remains unconnected. Browser voice implementation and verification are tracked below.
- Partial auto-placement, vector search, A2A task execution, production SSO, and certified Peppol validation are outside this delivered local demo. See `docs/ASSUMPTIONS.md` for precise behavior and rationale.
- No public deployment, remote push, real supplier order, payment, email, or SMS was made. The authorized Twilio reachability test is recorded above.

## Browser voice approval — 14 November 2026

- Added an interactive milk/butter/yoghurt/peanuts replenishment flow, live progress graph, larger sans-serif UI, responsive quotation and voice panels, and a live conversation transcript.
- Local demo quotations now always require explicit human approval, including low-value orders and amended proposals. The legacy CLI scenario asserts this requirement too.
- Added authenticated, mock-only browser voice session endpoints and a deterministic two-turn approval/rejection grammar. Atomic decisions retain stock, expiry, signature, mandate and revision checks. The model has no approval tool.
- Updated the private ElevenLabs agent successfully through the real provider SDK. WebRTC connected; user speech was transcribed and contextual responses named the correct four products and €110.82 total. Initial audio playback failed; enabling audio events and disabling provider-default hold queue fixed the connection path. The user held a live conversation and rejected the quotation by voice; the UI and ledger recorded rejection and no order was placed. A live spoken approval-to-order remains unexercised; automated tests cover it.
- `pnpm check`: 84 tests passed, including 15 voice boundary tests, followed by the isolated purchasing demo and ledger verification. `pnpm build`: passed again after the audio and queue fixes.
- Physical-phone HTTPS access, Telnyx activation/integration, PSTN/WhatsApp/Telegram calling and production voice identity verification are not complete. No new paid account upgrade or telephone call was made.

### Natural conversation refinement

- Removed mandatory recitation. Common natural requests and confirmations are accepted; model intent can prepare a confirmation for other wording but cannot commit a decision. A read-only status tool synchronizes the agent with the actual gateway result.
- Rewrote the prompt for brief, conversational answers, interruptions, and normal confirmation questions. Selected Eleven v4 Turbo expressive voice, normal turn-taking, and a shorter response budget. The real provider readback confirms `eleven_v4_turbo`, expressive mode enabled, queueing disabled, and both advisory/read-only client tools attached. Final `pnpm check` passed all **92 tests** and the isolated demo; `pnpm build` passed. A second live test used ordinary speech (“I don’t think I wanna go with it… not approve it”), the agent asked a cancellation question, and “Yeah, yeah, cancel it” recorded a voice rejection with no order. The compound wording “Yeah, go ahead. I’m not approving this” initially repeated the question and is now covered by a passing regression test. Voice timbre remains a user preference rather than an automated quality assertion. Added the provider end-call tool for spoken hang-up requests; that last behavior is provisioned but not yet exercised live.
