# Implementation tracker

## Personal fork, 24 November 2026

The fork adds versioned supplier declarations to the team's purchase and approval workflow. The local replay shows an approved budget exception and a refusal after the supplier withdraws its statement. REST and MCP expose both versions of the evidence. The demonstration uses simulated orders. [Rule and regression tests](docs/food-evidence.md)

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

## Compact agent workspace — 14 November 2026

- Removed the marketing header, onboarding blocks, date picker, revision badge and repeated summaries. Reduced composer/card spacing, joined ingredient rows and collapsed workflow/source detail.
- Delivery moves into the text prompt. A deterministic Helsinki-time resolver checks explicit/relative dates before requesting supplier offers; invalid, past, conflicting and recognized unsupported expressions are rejected. The resolved delivery date remains visible in review.
- Browser verification: “pasta for 80 on Tuesday” displayed Tuesday 17 November; the date input was absent and the new compact layout rendered. Desktop/mobile DOM checks found no horizontal overflow. Screenshot: `.local/agent-compact.png`. No real supplier order was placed.
- `pnpm check` passed 167 tests and the purchasing demo; `pnpm build` passed.

## Kitchen purchasing agent — 14 November 2026

- Added `/agent` with persistent editable kitchen preferences, text/menu-photo/voice-note input, actual tool progress, an editable interpretation and an attention-first review. Saved lunch/hotel starter profiles are explicit examples, not inferred history.
- Gemini provides advisory structured intent; deterministic TypeScript scales three sourced recipes, deducts confirmed pantry weights, selects catalogue candidates, checks signed offers and applies exact/approved SKU rules, claims and budget limits. Missing amounts/content, unknown availability and unsupported dishes remain decisions.
- Added scoped, revisioned and idempotent preparation APIs with transactional profile/plan writes, ownership checks and refreshed-offer validation before basket export. Existing human approval remains required. Basket handoff supports Undo and preserves exact/approved replacement restrictions through merges and restoration.
- Live Gemini verification: typed hotel request prepared the approved yoghurt replacement plus exact butter/milk; synthetic menu image and WAV each extracted 80 pasta portions and 5 kg pantry pasta. The nested provider schema initially failed; simplifying the provider schema while retaining full local validation resolved it. A transient local service interruption during testing recovered on retry.
- Browser verification covered profile save, progress, hotel exception review, basket handoff and a held human-review proposal with the existing weekly limit enforced. Mobile 390 px had no horizontal overflow.  Physical microphone recording is not yet verified. Prices/stock remain mock; no supplier fulfilment or telephone integration was exercised. See `docs/KITCHEN-AGENT-DEMO.md`.
- Final validation: `pnpm check` passed 162 tests plus the purchasing demo (17 verified ledger events); the subsequent budget-interpretation regression passed in the 16-test agent suite. `pnpm build` passed. Explicit SKU requests remain exact after display-name conversion. Screenshots: `.local/kitchen-agent-desktop.png` (full workspace capture) and `.local/kitchen-agent-mobile.png`.

## Product-view complementary recommendations — 14 November 2026

- Added “Goes well with this” directly beneath the product Add button, with at most three complementary items, short reasons, pack quantities, prices and individual Add actions. Product alternatives remain a separate inline function.
- Candidate sources are curated meal-pairing rules, the three sourced recipes, and actual co-occurrence in this browser's saved baskets. No aggregate “frequently bought together” claim, purchase-history model, paid recommendation service or sales-uplift measurement is implied.
- Reuses the fast catalogue suggest/offer endpoints without a new model call. Excludes the viewed SKU, same-type substitutes, duplicate recommendation groups, products already in the basket and completed add-on groups. Unknown/insufficient stock, missing prices and unsupported explicit dietary claims cannot be promoted.
- Additions retain dietary requirements, add a legal whole sales-pack increment for packaged goods, preserve existing basket lines and support Undo. Generic 0.01 supplier lots are not displayed as 0.01 of a case. Missing-photo placeholders in product details were reduced so recommendations appear sooner.
- Browser test: opening Barilla pasta surfaced tomato sauce, grated cheese and fresh basil; adding sauce produced one piece in the basket and removed the sauce recommendation group. Undo restored the prior basket. Verification used mock prices and stock, with no real supplier order.
- `pnpm check` passed with 146 tests and the purchasing demo; `pnpm build` passed. Desktop 1440 px and mobile 390 px layouts had no horizontal overflow. Screenshots: `.local/product-complements-desktop.png` and `.local/product-complements-mobile.png`.

## Proactive alternatives — 14 November 2026

- Removed the separate “Find alternatives” buttons and drawer. Product details automatically load one eligible option; blocked catalogue cards show a replacement inline. Basket and recipe rows surface one option when it resolves a known shortage or saves at least €1 on the converted pack total.
- Suggestions include product identity, sales-pack quantity, total, any excess contents and the supplier-listed/same-type basis. All swaps are explicit, with basket Undo. No additional LLM call is needed.
- Deterministic ranking rejects unknown/insufficient stock, later delivery, incompatible units, missing pack contents and missing required dietary declarations. Recipe suggestions must also match the published ingredient requirement; subsequent portion edits continue to scale automatically.
- Verified in the browser with mock offers: changing cream from 3 to 4 pieces surfaced a lower-total 10 L option with the extra 6 L stated; Swap updated the basket and Undo restored four original pieces. No real supplier write occurred. `pnpm check` passed with 140 tests and the purchasing demo; `pnpm build` passed. Mobile 390 px had no horizontal overflow. Screenshot: `.local/proactive-alternative-mobile.png`.

## Live chef workspace and search latency — 14 November 2026

- Removed the large promotional hero, local/hackathon banners and repeated explanatory copy. One conversational composer drives recipe cards, an editable ingredient workspace and the existing catalogue/basket controls. Small sample-price labels remain where money is shown.
- Added synchronous, deterministic `/v1/discovery/suggest` with a 180 ms typing debounce. It does not await Gemini, embeddings or the PGlite index. Background hybrid refinement starts after 900 ms idle; stale responses are ignored, and results do not silently reorder after interaction. Six measured localhost proxy requests returned in 20–73 ms (not a production SLA).
- Added three sourced Valio Aimo pasta recipes, published yields/ingredient weights and official recipe photographs. Matches render locally while typing; this is a curated recipe collection, not arbitrary recipe generation or a complete recipe search engine.
- Portion and pantry follow-ups update visible controls; verified KG pack contents determine rounding. Unspecified amounts, unknown pack contents and KG-to-litre conversions require a choice. Explicit dietary requirements remain attached to basket lines. Actual saved baskets influence recipe/product preferences; no customer order history is invented.
- Browser-tested 80 → 120 portions, “I already have pasta and carrots,” selected-only add-to-basket, and lactose-free persistence through a subsequent portion change. Commercial checks and human approval remain unchanged.
- Verification: `pnpm check` passed (136 tests plus the purchasing demo, ledger 17/17); `pnpm build` passed. Desktop 1440 px and mobile 390 px browser checks passed, including no mobile horizontal overflow. Screenshots are in `.local/live-recipes-desktop.png`, `.local/live-recipes-mobile.png` and `.local/live-ingredient-workspace.png`.
- OpenUI was researched but not added: typed React components already render these bounded interactions. Model-generated layouts are unnecessary for this flow. Gemini remains advisory for catalogue intent.

## Full-catalogue smart webshop implementation — 14 November 2026

- Replaced the ten-product homepage with the Valio-style full catalogue: search, URL filters, brand/dietary controls, details, comparison tray, editable basket, saved baskets, explicit replacements and Undo.
- Preserved all 17,546 supplied products and richer multilingual descriptions, ingredients, instructions, nutrition, origin and media references. Five verified product photos are used; other records show a placeholder. User confirmed that no media endpoint is available yet.
- Added scoped REST and MCP discovery/compare/alternative interfaces. Existing catalogue and purchasing contracts remain available; generated schemas/OpenAPI are refreshed. The localhost storefront proxy uses only buyer authority.
- Verified live Gemini structured intent (`gemini-3.5-flash-lite`). The cloud embedding trial reached quota after 146 records, so indexing moved to a local multilingual MiniLM model. Completed 17,546/17,546 local embeddings with content/model version checks and atomic activation of the complete index.
- Deterministic declaration filters, quantity conversion, exact money arithmetic, offer refresh, idempotent proposal retry and mandatory human review remain outside model control. Added boundary tests for unknown stock, missing/contradictory requirements, invalid identifiers, unverified conversions and access scopes.
- Browser-tested search, two-product comparison, direct quantity editing, replacement consequences, explicit replacement, Undo and a held human-approval request. Tested 1440px desktop and 390px mobile layout. Supplier prices/availability were mock data; no new real supplier order or phone call was made.
- Local hybrid search is a separate in-memory PGlite/pgvector read store; cold reconstruction remains noticeable. Hosted judge search uses the bounded lightweight catalogue path. Hosting the full PGlite/pgvector refinement index, production buyer SSO, official taxonomy, catalogue-wide photography and a chef-labelled held-out relevance study remain further validation work.
- Reproduction steps and exact integration boundaries: `docs/SMART-WEBSHOP-DEMO.md`. The original plan below records the earlier planning turn, not current implementation status.

## Smart webshop implementation plan — 14 November 2026

- Recorded the user-requested full-catalogue, Valio-style webshop direction in `docs/SMART-WEBSHOP-PLAN.md`; it supersedes the lunch-first UI plan.
- Plan covers all 17,546 records, richer catalogue normalization, keyword/semantic discovery, Gemini intent extraction, product comparisons, contextual alternatives, image resolution and scoped cart/agent integration. Milestones include measurable acceptance checks and fallback behavior.
- Verified from supplied data: 13,375 products have media references but no image URLs/files; the supplied API has no media route. Image resolution and official category taxonomy remain external inputs. Provider documentation was reviewed; no new model calls, embeddings, extension migrations or UI implementation were exercised in this planning turn.

## Chef workspace design preview — 14 November 2026

- Revised the homepage into a task-driven workspace: requests and task chips render central comparison cards, quantity proposals and savings proposals. Lunch ingredients use editable rows; catalogue cards remain under Add an ingredient / Shop products. The desktop side panel is the current basket.
- Portion and savings suggestions show before/after quantities and totals, require Apply changes, and support Undo. Editing the basket clears stale suggestions; a deterministic base-draft comparison also prevents stale application. Four new regression tests cover these boundaries and dietary preservation. `pnpm check` passed with 105 tests and the isolated purchasing demo. Desktop browser checks verified request → proposal → apply → undo and invalidation after editing the cart; the 390 × 844 mobile proposal has no horizontal overflow. The final `pnpm build` passed. Screenshot: `.local/chef-interactive-workspace.png`.
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
- No real supplier order, payment, email, or SMS was made. The public sandbox deployment is recorded below.

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

## Railway public judge sandbox — 15 November 2026

- Deployed `main` to Railway project `truthful-cat`, service `junction-repo`, at https://junction-repo-production.up.railway.app. The hosted container build succeeded; its 500 MB persistent volume is ready at `/data`. The current Railway plan caps volume size at 500 MB, which is sufficient for the business database and ledger because the full catalogue and search index are bundled/rebuilt by the app.
- Fixed hosted catalogue search memory use by streaming candidates from the catalogue's existing index instead of eagerly copying all product names and hashes into another 17,546-record cache. Installed `procps` so the container supervisor can recover when a child process exits. The lightweight public search path stays deterministic and does not initialize PGlite.
- `pnpm check` passed all 174 tests, the isolated purchasing demo, and ledger verification. `pnpm build` passed. Remote `/health` returned HTTP 200, `mode=valio`, and `catalogCount=17546`; `/` returned HTTP 200. Public `/api/shop/suggest` for “milk” and `/api/shop/search` for “milk” and “butter” returned HTTP 200 with Valio catalogue records. After search requests, Railway memory was 811 MB of the 1,024 MB service limit, below the previous 1,011 MB peak that caused restarts.
- Public demo login, admin snapshot, and storefront customer context returned HTTP 200. A read-only offer lookup for product 464201 returned HTTP 200 with `source=valio`. Railway credentials are stored as service variables; none are in Git.
- No proposal or order was created on the public service during verification. The public workspace and its ledger are shared; order placement remains simulated, with no supplier order adapter.
