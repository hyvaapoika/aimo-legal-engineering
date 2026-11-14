# Aimo Agent Gateway — Junction 2026 implementation plan

Nov 14, 2026 · @safiul alam

## Overview

We are building the door through which any external purchasing agent can buy from Valio Aimo: a structured, open interface plus the operating model that decides what an agent may do alone and what needs a human. Aimo owns the identity check, the rules, the approval (including the phone call), the order and the record. The restaurant side is a thin reference agent that proves the door works; an off-the-shelf agent (Claude Desktop) proves it is open.

Pitch sentence: an agent-native commerce gateway with delegated authority, deterministic guardrails and human-in-the-loop approval, built on MCP, A2A discovery and verifiable offers.

What Aimo gets at the end of the weekend: a running gateway over their mock APIs, the webshop screens that manage agents and approvals, published JSON Schemas and OpenAPI for the interface, a Peppol export, and this plan.

| Component name (how we sell it) | What it actually is |
| --- | --- |
| Agent Gateway | MCP server + REST mirror + discovery profile |
| Agent Identity & Registry | Per-agent Ed25519 keys, RFC 9421 signed requests, agent → customer binding |
| Delegated Authority (Mandates) | Machine-readable scope and limits a customer grants an agent |
| Guardrail / Policy Engine | Deterministic rules: authority, mandate, feasibility, anomaly |
| Human-in-the-Loop Orchestration | Proposal state machine, approver routing, timeouts, fallbacks |
| Multichannel Approval Agent | Gemini Live voice call + in-app card + SMS |
| Exception Handling Agent | LLM ranks and explains substitutes from code-filtered candidates |
| Verifiable Offers | Signed price and availability with validity window |
| Audit Ledger & Observability | Hash-chained events, plain-language timeline, traces |
| Interoperability Layer | A2A agent card, UCP-shaped profile, Peppol BIS export, JSON Schemas |
| Reference Buyer Agent | Claude Agent SDK client that walks through the door end to end |
| Cross-Model Verification | Second model family checks a proposal before submission |

Model split: Gemini runs everything on Aimo's side (structured output, embeddings, voice). Claude runs the external buyer. Decisions about permission, units and money are code, never a model.

## Scope against the challenge

Every scored line has a concrete artifact behind it; the three optional directions are covered at the depth the rubric pays for, no deeper.

| Challenge item | Weight | Our deliverable |
| --- | --- | --- |
| Core: product, price & availability lookup | must | `search_catalog` + `get_offers` over Valio's price and availability APIs, signed, customer-scoped |
| Core: inquiry → order at fixed prices | must | Offer (with validity) → proposal → rules → order; no negotiation path exists |
| Core: permission & human approval | must | Mandates per agent, rules engine verdicts AUTO / HOLD / REFUSE, approval by app, SMS or Aimo phone call |
| Optional: delivery & sustainability comparison | optional | Reliability and carbon as labelled ranking signals in offers and substitutes |
| Optional: substitution & exceptions | 15% of judging | Good-better-best from Aimo's own alternatives, allergen rule enforced, trade-off sentence |
| Optional: traceability & explainability | inside 20% controls | Hash-chained ledger, plain-language timeline, Aimo activity feed with refused attempts |
| Insight: trust protocol | — | Signed requests (agent identity) and signed offers (Aimo claims) with validity |
| Insight: guardrails model | — | Mandate schema + rule table in section 8 |
| Insight: response logic | — | Exception ranker in component 4 |
| Insight: audit trail | — | Ledger, two views |
| Judging: working end-to-end demo | 30% | Request → lookup → proposal → approval → order on the mocked environment, recorded |
| Judging: solving the user need precisely | 20% | Feasibility module: litres → sales units → cases, lot size, cut-off, unknown stays unknown |
| Judging: autonomy and controls | 20% | Mandates, rules engine, approval records, ledger |
| Judging: robustness to exceptions | 15% | Short, late, blocked, unpriced, terminal-unknown handled with typed reasons |
| Judging: openness & production path | 15% | MCP + REST + OpenAPI, discovery profile, A2A card, Peppol export, published schemas, assumptions file |

Out of scope by design: payments (B2B is invoiced on account terms), a marketplace, a chat UI, the hotel's inventory system beyond a CSV trigger.

## User flow

One planned human touch, a second only when something is actually wrong. Approval lives in Aimo's webshop, where the customer's users already exist.

1. Setup, once. The hotel's purchasing admin opens the Aimo webshop → Settings → Agent access → Add agent. Gets a key pair, sets the mandate: € per order, € per rolling week, allowed categories and delivery sites, substitution policy, allergen profile, approvers with channel order (call → SMS → inbox) and quiet hours.
2. Trigger. The hotel's agent reads stock (mock CSV): milk 120 L on hand, 400 L/week usage. It builds a requirement: 1,000 L lactose-free milk, 200 kg yoghurt, 60 kg butter, 150 kg fish, by Monday.
3. Discovery and identity. The agent fetches `/.well-known/aimo-agent.json`, learns the MCP endpoint, signs its requests. Aimo resolves agent → customer → scopes.
4. Lookup. `search_catalog` per line → shortlist → one batched `get_offers`. Aimo returns signed offers: customer net price with validity, availability lines, cut-off, lot size, pack hierarchy, reliability, carbon. Fish is short; the usual yoghurt is sales-blocked.
5. Exceptions. For short or blocked lines Aimo includes ranked substitutes from its own assortment with a one-sentence trade-off, allergen rule applied.
6. Proposal. The agent converts litres and kilos into sales units and cases, checks lots and cut-offs, and submits a proposal with exact lines and the offer IDs it relied on.
7. Rules. Aimo evaluates: authority, mandate, feasibility, anomaly. Milk and butter are within authority → placed. Fish substitution and the total exceed limits → held. A line with no price would be refused with a structured reason.
8. Approval. Aimo calls the registered approver: what, total, delivery day, the substitution and why. Approve / approve with amount / reject / call back. The decision is read back and recorded. No answer → SMS link → inbox.
9. Order. Aimo places the order, assigns delivery date from the availability line, texts the confirmation, returns the result to the agent, exports a Peppol Order document. Invoiced on account terms.
10. Record. Every step is a ledger event. The customer sees it under their agent; Aimo sees it per customer, with held and refused attempts highlighted.

The same path with Claude Desktop pointed at the MCP URL and no custom code is the openness proof.

## Technical architecture

&#91;embedded content: technical architecture · gateway, services, external systems\]

Agents enter at the top through discovery and identity; requests flow down through the door, the services and the rules into the ledger and database. The bottom row is what the gateway talks to: Valio's mock price and availability APIs (offer service), Twilio with Gemini Live (approval service) and the webshop screens (all services through the REST mirror). The rules engine is highlighted because it is the only place a decision is made, and it is code.

## Component specifications

Thirteen components; 1–3, 5–7 and 11 are the critical path. Each row's acceptance criterion is the test the coding agent must make pass before moving on.

| # | Component | Responsibility | Interface | Tech | Acceptance criterion |
| --- | --- | --- | --- | --- | --- |
| 1 | Catalog service | Ingest product JSON + reliability + carbon CSVs; normalise units, packs, lot size, claims, allergens, substitutions, net content (parsed from name if no field, flagged `inferred`) | `searchCatalog(q, filters)`, `getProduct(id)`, `getSubstitutes(id)` | Postgres FTS (fi/en) + pgvector with `gemini-embedding`; ingest script | "lactose-free milk" returns product 464201 in top 3; every product has units and lot size populated |
| 2 | Offer service | Batch `/api/price` + `/api/availability` for a shortlist; merge by productId; attach cut-off, salesBlock, lots, comparison price; sign as JWS with `validUntil` | `getOffers(customerId, productIds[], requestedDate)` | Fetch adapter + local replay mock behind `MOCK_VALIO`; `jose` Ed25519 | One call per API for ≤ 1,000 IDs; null price → `unpriced`; signature verifies against JWKS |
| 3 | Feasibility module | Requirement qty (L/kg/pcs) → sales units → cases/pallets; lot size, cut-off vs now, availableDate vs needed, empty scheduleLines, 999999 terminal | pure functions, shared package | TypeScript, unit tests | 1,000 L of 1 L cartons → 1000 ST / 100 KI; each failure mode returns a typed reason |
| 4 | Exception ranker | Good-better-best from explicit substitutions → same category + same claims → same category; allergen filter; score by comparison price, reliability, carbon | `rankSubstitutes(line, profile)` | Code for candidates; Gemini Flash structured output for the one-sentence trade-off | Strict allergen profile never returns a product without a positive matching claim |
| 5 | Door: MCP + REST + discovery | Expose tools, mirror as REST with OpenAPI, publish `/.well-known/aimo-agent.json`, `agent-card.json`, `jwks.json` | 5 tools, see section 7 | `@modelcontextprotocol/sdk` Streamable HTTP, Hono | Claude Desktop connects with only the URL and completes search → offers → proposal |
| 6 | Agent registry + mandates | Agents, keys, mandates, approvers per customer | CRUD via REST; used by middleware and rules | Postgres tables; Mandate JSON Schema | Request signed by an unknown key is rejected 401; known key resolves to its customer |
| 7 | Rules engine | Authority, policy, anomaly passes → verdict + fired rules | `evaluate(proposal, mandate, offers, history)` | Table-driven TypeScript, one test per rule | Over-limit proposal → HOLD with rule id; expired offer → REFUSE; in-limit → AUTO |
| 8 | Approval service | Proposal state machine; approver routing by channel order; timeouts and fallbacks; amended proposals re-evaluated | `hold(proposal)`, `decide(approvalId, decision)` | TypeScript, Postgres, job queue (pg-boss) | HOLD → call → no answer 2 min → SMS → inbox; decision recorded with channel and approver |
| 9 | Voice approval worker | Outbound call, scripted summary, decision enum, read-back, PIN check, transcript | Twilio Media Streams ↔ Gemini Live function calls | Separate process, `VOICE_ENABLED` flag | Spoken "approve six hundred" → `approve_with_amount: 600`; ambiguity → fallback to SMS |
| 10 | Order service | Create mock order from AUTO or approved proposal; delivery date from availability line; Peppol T01 XML; SMS confirmation; webhook/poll to agent | `placeOrder(proposalId)`, `getOrder(id)` | TypeScript, XML template, Twilio SMS | Order carries offerIds, approvalId or verdictId; Peppol file validates against schema |
| 11 | Ledger | Append-only hash-chained events; projections: customer timeline, Aimo activity feed; verify endpoint | `append(event)`, `timeline(agentId)`, `feed(customerId)`, `verify()` | Postgres table with prev\_hash/hash | Tampering any row makes `verify()` fail; every service call produces an event |
| 12 | Webshop screens | Agent access, Awaiting approval, Order + ledger, Aimo admin feed | REST mirror | Next.js App Router, shadcn primitives restyled (section 11) | Approve from the card places the order and the timeline updates without reload |
| 13 | Reference buyer agent | Inventory CSV → requirement → door → proposal → status; optional cross-model check | CLI | Claude Agent SDK, MCP client, shared feasibility module | Full run from CSV to confirmed order with one command; Claude Desktop config checked in |

## Data model and schemas

Eight objects, all published as JSON Schema in `packages/schema` and used by the gateway, the UI and the reference agent. Product ID is the join key everywhere.

| Object | Key fields | Notes |
| --- | --- | --- |
| Requirement | `id`, `customerId`, `lines[{need: {qty, unit: L/KG/PCS}, constraints: {claims[], allergenProfile}, hint}]`, `neededBy`, `source: inventory/manual` | Built by the buyer; never seen by Aimo except as proposal context |
| Offer | `id`, `customerId`, `productId`, `gtin`, `salesUnit`, `packs[{unitId, sizeInBaseUnits}]`, `allowedLotSize`, `netContent{value, unit, inferred}`, `price{value, currency, validFrom, validTo, netPriceFound}`, `comparisonPrice{value, unit}`, `availability[{amount, date, salesUnit, salesBlock}]`, `closingTime`, `logisticModel`, `reliability?`, `carbonKgPerKg?`, `validUntil`, `signature` | `validUntil` = min(price validTo, closingTime, issuedAt + 30 min). Missing reliability or carbon stay absent, never 0 |
| Proposal | `id`, `agentId`, `customerId`, `requestedDate`, `deliverySite`, `lines[{productId, qty, salesUnit, offerId, substituteFor?, rationale}]`, `total`, `status`, `requirementRef?` | Status: submitted → evaluated → auto / held / refused → approved / amended / rejected → placed |
| Mandate | `agentId`, `limits{perOrder, perWeek, currency}`, `categories[]`, `deliverySites[]`, `substitutionPolicy: explicit / category / none`, `allergenProfile: strict / standard`, `approvers[{userId, channels[], quietHours}]`, `validTo` | Edited in Agent access; versioned |
| Verdict | `proposalId`, `result: AUTO / HOLD / REFUSE`, `perLine[{productId, result}]`, `firedRules[{id, severity, message, observed, limit}]`, `challengeToken?` | One per evaluation; amended proposals get a new one |
| Approval | `id`, `proposalId`, `approverId`, `channel: app / sms / voice`, `decision: approve / approve_with_amount / reject / callback`, `amendedLines?`, `transcriptRef?`, `recordingRef?`, `decidedAt`, `signature` | Signed by Aimo over proposal line hash + decision |
| Order | `id`, `proposalId`, `verdictId`, `approvalId?`, `lines`, `total`, `deliveryDate`, `confirmedAt`, `peppolRef`, `smsRef` | Mock, since Valio exposes no order endpoint |
| LedgerEvent | `seq`, `ts`, `type`, `actor{kind: agent / aimo / human, id}`, `refs{}`, `payload`, `prevHash`, `hash` | Types: request.received, offers.returned, proposal.submitted, rules.evaluated, approval.requested, approval.decided, order.placed, request.refused |

Unit handling rule: every quantity carries its unit; conversion to sales units happens once, in the feasibility module, and the proposal stores sales units only. The buyer's litres and the offer's `ST` never meet anywhere else.

## Interface specification

Five tools, mirrored 1:1 as REST, discoverable from one well-known file. An agent that can read JSON and sign an HTTP request needs nothing else.

| Tool | REST | Input | Output |
| --- | --- | --- | --- |
| `search_catalog` | `GET /v1/catalog/search` | `query`, `filters{category?, claims[]?, allergenFree[]?, tempClass?}`, `limit` | Ranked products: id, names (fi/en), brand, salesUnit, packs, lotSize, netContent, claims, substitutions\[\] |
| `get_offers` | `POST /v1/offers` | `productIds[] (≤1000)`, `requestedDate`, `includeSubstitutesFor[]?` | Signed Offer\[\] for the agent's customer; for listed lines also ranked substitutes with trade-off text |
| `submit_proposal` | `POST /v1/proposals` | Proposal (lines with offerIds) | `proposalId`, Verdict (AUTO / HOLD / REFUSE), per-line results, fired rules, `challengeToken?` |
| `get_proposal` | `GET /v1/proposals/{id}` | id | Status, approval summary (channel, decidedAt, amended lines), order id when placed |
| `get_order` | `GET /v1/orders/{id}` | id | Order, delivery date, Peppol document URL |

Discovery, served unauthenticated:

- `/.well-known/aimo-agent.json` — UCP-shaped profile: `version`, `services.commerce.capabilities[]` (catalog, offers, proposals, orders), `transports{mcp: url, rest: url, openapi: url}`, `signing_keys: jwks url`, `auth: {scheme: "http-message-signatures", alg: "ed25519", registration: url}`, `terms`, `policies`.
- `/.well-known/agent-card.json` — A2A agent card describing the same capabilities for agent-to-agent discovery.
- `/.well-known/jwks.json` — Aimo's public keys for verifying offer and approval signatures.
- `/openapi.json` — the REST mirror.

Authentication: the agent signs each request per RFC 9421 (`Signature-Input`, `Signature` headers, Ed25519, covered components `@method @path content-digest created`). Middleware looks up `keyid` in the registry, verifies, rejects replays older than 5 minutes, and attaches `{agentId, customerId, scopes}` to the request. Demo fallback: `Authorization: Bearer <agent token>` accepted when `ALLOW_BEARER=true`, so Claude Desktop can connect without a signing plugin; the reference agent always signs.

Scopes: `catalog:read`, `offers:read`, `proposals:write`, `orders:read`. Prices are always resolved for the bound customer; an agent cannot ask for another customer's prices.

Error shape: every refusal is `{code, message, details}` with codes the agent can act on: `UNPRICED`, `SALES_BLOCK`, `PAST_CUTOFF`, `OFFER_EXPIRED`, `OUT_OF_MANDATE`, `ALLERGEN_RULE`, `UNKNOWN_QUANTITY`.

## Rules engine

The engine is a pure function `evaluate(proposal, mandate, offers, history) → Verdict`. It runs three passes in order and stops at the first REFUSE; HOLD results accumulate; AUTO means nothing fired. Every rule has an id, a severity, a human sentence template and the observed and limit values, so the ledger and the approval card can show exactly why.

| Pass | Rule id | Check | Result if it fails |
| --- | --- | --- | --- |
| Authority | AUTH\_AGENT\_ACTIVE | Agent exists, not revoked, mandate not expired | REFUSE |
| Authority | AUTH\_SCOPE | Agent has `proposals:write` | REFUSE |
| Authority | AUTH\_CUSTOMER\_MATCH | Every offerId belongs to this customer | REFUSE |
| Feasibility | FEAS\_OFFER\_VALID | Offer signature verifies and `validUntil` not passed | REFUSE (OFFER\_EXPIRED) |
| Feasibility | FEAS\_PRICED | Price present, `netPriceFound` or list price accepted by mandate | REFUSE (UNPRICED) |
| Feasibility | FEAS\_NOT\_BLOCKED | No product- or line-level salesBlock | REFUSE (SALES\_BLOCK) |
| Feasibility | FEAS\_CUTOFF | now < closingTime | REFUSE (PAST\_CUTOFF) |
| Feasibility | FEAS\_QTY\_KNOWN | availableAmount ≠ 999999 for terminal items, else HOLD | HOLD |
| Feasibility | FEAS\_LOT | qty is a multiple of allowedLotSize | REFUSE |
| Feasibility | FEAS\_AVAILABLE | qty ≤ availableAmount on a line dated ≤ requestedDate, else partial | HOLD (partial) |
| Policy | POL\_PER\_ORDER | total ≤ limits.perOrder | HOLD |
| Policy | POL\_PER\_WEEK | rolling 7-day placed total + this ≤ limits.perWeek | HOLD |
| Policy | POL\_CATEGORY | every line's category in mandate.categories | HOLD |
| Policy | POL\_SITE | deliverySite in mandate.deliverySites | HOLD |
| Policy | POL\_SUBSTITUTION | substitute lines satisfy substitutionPolicy level | HOLD |
| Policy | POL\_ALLERGEN | strict profile: every line has a positive matching claim | REFUSE (ALLERGEN\_RULE) |
| Anomaly | ANOM\_LINE\_QTY | qty > 5 × trailing average for this customer and product | HOLD |
| Anomaly | ANOM\_ORDER\_TOTAL | total > 3 × median of last 10 orders | HOLD |
| Anomaly | ANOM\_NEW\_PRODUCT | product never ordered by this customer and total line value > €500 | HOLD |

Per-line splitting (`ALLOW_PARTIAL_AUTO=true`): lines that pass everything are placed immediately; lines with a HOLD go to approval as one held proposal; the agent receives both results in the same verdict.

Challenge flow: a HOLD verdict carries a `challengeToken`. If the approver amends quantities, the amended proposal is re-evaluated with the token so the anomaly pass knows a human has already seen it; a second HOLD on the same rule is still routed to the human, never auto-approved.

Human sentence examples the engine emits: "Order total €4,820 exceeds your per-order limit of €2,000." "Fish line 150 kg is 6× your usual 25 kg." "Yoghurt 469363 is sales-blocked until Wednesday; substitute 469380 proposed."

What the engine never does: call a model, read free text, or guess intent. Anything it cannot verify from structured data goes to a human.

## Approval orchestration and voice

A held proposal reaches a registered approver on their configured channels in order, with a timeout per channel; the first decision wins and later channels are cancelled. Default demo approver: call first, SMS after 2 minutes, inbox always.

State machine: `held → notifying → (approved | amended | rejected | expired)`. `amended` re-enters the rules engine with the challenge token. `expired` after 4 hours → the agent is told to resubmit.

Approval card (app and SMS link open the same page): request in one line, proposed lines with quantities in sales units and the human quantity beside them ("100 cases · 1,000 L"), total, delivery day, the substitution and its one-sentence trade-off, the rule that fired in plain words, three actions: Approve, Change amounts, Reject. One tap on Approve.

Voice call design:

1. Approval service enqueues a `voice.call` job with the proposal summary already rendered to text by the engine (no free generation of facts).
2. Worker places a Twilio outbound call to the approver's registered number and bridges Media Streams to Gemini Live.
3. System prompt is fixed: identity ("This is Valio Aimo's ordering assistant"), PIN check first, then the summary verbatim, then "Approve, change the amount, reject, or call back?"
4. Allowed outcomes are function calls: `approve()`, `approve_with_amount(productId, qty)`, `reject(reason)`, `callback()`. No other action is possible.
5. The model must read back the decision and receive an explicit yes before the function call is accepted.
6. Any ambiguity or two failed read-backs → "I'll send this to your app" → SMS fallback.
7. Transcript, recording URL and the parsed decision are written to the Approval and the ledger.

Guardrails on the call: the worker never has write access beyond `decide(approvalId, decision)`; the PIN is checked by code against the approver record, not by the model; quiet hours route straight to SMS; the call is capped at 3 minutes.

Fallback plan for the demo: if telephony fails at the venue, the same job renders the summary as an SMS and the card; the recorded call is kept as a clip for the video.

## Ledger and explainability

One append-only table, written by every service through a single `append()` function, is the whole audit trail; the two screens are projections of it.

- Storage: `ledger_events(seq bigserial, ts, type, actor_kind, actor_id, customer_id, agent_id, refs jsonb, payload jsonb, prev_hash, hash)`. `hash = sha256(prev_hash || canonical_json(event))`. A `verify()` endpoint recomputes the chain and reports the first broken link.
- Event types: `request.received`, `offers.returned`, `substitutes.proposed`, `proposal.submitted`, `rules.evaluated`, `request.refused`, `approval.requested`, `approval.channel_attempted`, `approval.decided`, `order.placed`, `order.exported`.
- Rendering: each event type has a sentence template filled from payload, e.g. "Agent Hotel Haven buyer asked for 1,000 L lactose-free milk by Mon 17 Nov" / "Rule POL\_PER\_ORDER held the proposal: €4,820 exceeds €2,000" / "Maija K. approved 600 kg by phone at 06:12". Gemini Flash is used only to smooth sentences for substitute trade-offs; every number comes from the payload.
- Customer view: a vertical timeline per agent, newest first, with the hash stub in mono and links to the proposal, approval transcript and order.
- Aimo view: activity feed per customer with filters `refused`, `held`, `auto`; refused and held rows carry the fired rule inline. This is the screen that shows guardrails working.
- Export: timeline as CSV and JSON; order as Peppol BIS Order (T01) XML with GTIN, GLN placeholders and the approval id in `cbc:Note`.

Explainability promise, stated in the UI: every order can be traced to the offer it was priced on, the rule result that allowed it, and the person or mandate that authorised it.

## UI design system and screens

Direction: Nordic trade press meets a logistics terminal. Paper-calm, dense with numbers, no marketing gloss. shadcn stays as unstyled primitives; every token and layout habit is replaced.

| Token | Value |
| --- | --- |
| Display type | Fraunces (or Instrument Serif), 500 weight, page titles and the approval headline only |
| UI type | Geist or Inter Tight, 400/500 |
| Numeric type | Geist Mono or JetBrains Mono, tabular figures, for every price, quantity, ID, hash, time |
| Background | Cream paper `#F6F3EC`; cards one step lighter `#FBF9F4`; hairlines `#D9D4C7` |
| Ink | Deep blue `#0E2A47` for text and primary action |
| Needs decision | Dairy amber `#C98A1B` (fill at 12% behind held rows) |
| Auto-approved | Muted green `#3E7A4F` |
| Refused | Brick `#9E3B2E`, used only for refused rows and the verify-failed state |
| Aimo admin | Dark mode only: ink `#0B1D2E` background, cream text; the operator view looks different from the customer view on purpose |
| Radius | 4 px controls, 8 px cards; no pill shapes |
| Spacing | 8 px grid; tables full-width with hairline row rules; labels left, figures right |
| Motion | One 200 ms transition when a proposal moves Held → Approved → Placed; nothing else animates |

Screens:

1. Agent access (customer settings). Table of agents: name, key fingerprint, status, mandate summary, last activity. Add agent drawer: generate or upload key; mandate form with limits, categories (multi-select from catalog categories), sites, substitution policy, allergen profile, approvers with channel order and quiet hours. Save shows the mandate as JSON in a collapsible panel for the technical reader.
2. Orders → Awaiting approval. List of held proposals as receipt-style cards: request line, lines with sales units and human quantity, total in serif display, trade-off pull-quote, fired rule in amber, Approve / Change amounts / Reject. Approving animates the card to Placed and adds the ledger entry below.
3. Order detail. Header with order id, delivery date, total; lines table; vertical ledger timeline with thin spine and mono hash stubs; "Verified by Aimo" mark beside the signed price; quiet links: Peppol XML, transcript, JSON.
4. Aimo admin (dark). Customers → agents → activity feed; filters auto / held / refused; a red row shows the rule that refused; a "verify chain" button runs `verify()` and shows the result.
5. Discovery page (public). Human-readable rendering of `/.well-known/aimo-agent.json`: endpoints, tools, auth, a copy-paste Claude Desktop config block.

Rules for the coding agent: load the frontend-design skill before generating UI; no gradients, no hero sections, no card grids, no emoji icons (Lucide outline only); real Finnish product names and realistic quantities in all fixtures; dates as "Mon 17 Nov".

## Repository, stack and configuration

One TypeScript monorepo (pnpm workspaces + Turborepo) so the gateway, UI and reference agent share schemas and the feasibility module.

```markdown
aimo-agent-gateway/
  apps/
    gateway/        Hono API + MCP server + REST mirror + discovery + workers
    web/            Next.js webshop screens (customer + Aimo admin)
    buyer-agent/    Claude Agent SDK reference client + inventory trigger
  packages/
    schema/         JSON Schemas + generated TS types (Requirement, Offer, Proposal, Mandate, Verdict, Approval, Order, LedgerEvent)
    feasibility/    unit conversion, lots, cut-off, availability checks + tests
    rules/          rules engine, rule table, tests
    catalog/        ingest scripts, search, substitutes
    valio-client/   adapter to /api/price and /api/availability + replay mock
    signing/        JWS offers/approvals, RFC 9421 request signing/verification
    peppol/         Order T01 / Order Response T76 templates
    ui/             restyled shadcn primitives, tokens, fonts
  data/
    products.json, delivery_reliability.csv, carbon_footprint.csv, inventory.csv, fixtures/
  docs/
    ASSUMPTIONS.md, openapi.json, discovery examples, Claude Desktop config
  infra/
    docker-compose.yml (postgres+pgvector), fly.toml, .env.example
```

| Concern | Choice | Why |
| --- | --- | --- |
| Runtime | Node 22, TypeScript, Hono | One language end to end; MCP SDK is first-class in TS |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP | Claude Desktop and most clients connect directly |
| DB | Postgres 16 + pgvector (Neon or local Docker) | FTS, vectors, hash-chained ledger in one place |
| ORM | Drizzle | Thin, typed, fast to iterate |
| Jobs | pg-boss | Approval timeouts and voice jobs without another service |
| Models (Aimo) | Gemini 2.5 Flash structured output; `gemini-embedding`; Gemini Live | One vendor on Aimo's side, cheap and fast |
| Models (buyer) | Claude via Agent SDK | Native MCP client, strong tool use; shows cross-vendor interop |
| Telephony | Twilio Voice + Media Streams, Twilio SMS | Simplest outbound call path to a realtime model |
| Signing | `jose` (JWS Ed25519), RFC 9421 library | Standards, verifiable with public JWKS |
| UI | Next.js 15, shadcn primitives, Tailwind tokens from section 11 | Fast screens, restyled |
| Deploy | Fly.io for gateway + worker, Neon Postgres, Vercel for web; ngrok for Twilio webhooks locally | Public HTTPS for MCP and Twilio in minutes |

Environment flags: `VALIO_BASE_URL`, `VALIO_API_KEY`, `MOCK_VALIO=true|false`, `ALLOW_BEARER=true`, `ALLOW_PARTIAL_AUTO=true`, `VOICE_ENABLED=false`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `TWILIO_*`, `AIMO_SIGNING_KEY` (Ed25519 private, JWK).

Secrets never go in the repo. The Junction API key lives in `.env` only.

## Build order and team split

The end-to-end AUTO path must run by hour 10; everything after that is additive and can be cut. Integrate on the shared schemas by hour 3, before anyone builds deep.

| Hours | Owner A (data) | Owner B (gateway) | Owner C (approval) | Owner D (UI + buyer) |
| --- | --- | --- | --- | --- |
| 0–3 | Repo scaffold, `packages/schema` with all 8 schemas, fixtures | Postgres + Drizzle, ledger table + `append()`, Hono skeleton | Twilio + Gemini Live hello-world call | Next.js scaffold, tokens, fonts, restyled table and card |
| 3–7 | Catalog ingest + FTS; feasibility module + tests | MCP server with `search_catalog`, `get_offers`; valio-client + replay mock; offer signing | Approval service state machine + pg-boss; approval card page data | Agent access screen; discovery page |
| 7–10 | Substitute candidates (code) + Gemini trade-off text | Rules engine authority + feasibility passes; `submit_proposal` AUTO path; order service mock + ledger events | SMS link + card approve/reject wired | Reference buyer agent: CSV → requirement → door → proposal; Claude Desktop connects |
| 10 | Checkpoint: AUTO path end to end on the mock, recorded |  |  |  |
| 10–16 | pgvector + embeddings; reliability + carbon in offers | Policy + anomaly passes; HOLD + challenge flow; RFC 9421 verification | Voice worker: script, function calls, read-back, PIN, fallback | Awaiting approval screen; order detail + ledger timeline |
| 16–20 | Peppol T01 export | Discovery files, OpenAPI, bearer fallback, error codes | Voice end to end on a real phone; recording | Aimo admin dark view + activity feed; verify button |
| 20 | Checkpoint: HOLD → call → approve → order recorded; refused attempt visible in feed |  |  |  |
| 20–25 | Fixtures for the four-line scenario; edge cases (terminal 999999, blocked yoghurt) | Hardening, rate limits, logs | Partial auto-approval; amended re-evaluation | Polish screens; Claude Desktop walkthrough recorded |
| 25–28 | ASSUMPTIONS.md, README, schema docs | Deploy to Fly + Neon; public MCP URL | Cross-model verifier in buyer (optional) | Video capture of all screens |
| 28–30 | Freeze. Only fixes for what breaks in the final run-through |  |  |  |

Cut list, in order, if behind at hour 20: cross-model verifier, pgvector, Peppol export, Aimo admin dark view, voice (keep SMS + card), partial auto-approval.

Never cut: feasibility correctness, rules engine with fired rules, the approval card, the ledger, Claude Desktop connecting with only the URL.

## Instructions for Claude Code / Codex

Paste this section as the first message (or save it as `CLAUDE.md` / `AGENTS.md` at the repo root). Run one phase per session; each phase ends with its tests green and a short `PROGRESS.md` entry.

```markdown
# Aimo Agent Gateway — build instructions

You are building the system described in docs/PLAN.md (this document, exported). Follow it literally; where it is silent, choose the simplest option and record the choice in docs/ASSUMPTIONS.md.

Ground rules
- TypeScript everywhere. pnpm workspaces + Turborepo. Node 22.
- Decisions about permission, units, money and approval are code with unit tests. Never put them in a prompt.
- Every service call writes a ledger event through packages/ledger append(). No exceptions.
- Missing data stays missing: no price = UNPRICED, no carbon = absent, no allergen declaration = unknown (not free-from).
- Secrets only in .env. Never commit the Valio API key.
- Before any UI work, load the frontend-design skill and docs/PLAN.md section 11. No gradients, hero sections, card grids or emoji.
- Commit after each task with a one-line message. Keep PROGRESS.md current.

Phase 0 — scaffold (stop when `pnpm test` passes with placeholder tests)
1. Create the monorepo layout from PLAN.md section 12.
2. packages/schema: write the 8 JSON Schemas from section 6; generate TS types (json-schema-to-typescript). Add fixtures/ with the four-line scenario (milk 464201, a yoghurt, a butter, a fish) using real IDs from data/products.json.
3. docker-compose with postgres:16 + pgvector. Drizzle config. Migration for agents, agent_keys, mandates, approvers, offers, proposals, verdicts, approvals, orders, ledger_events.

Phase 1 — data (stop when acceptance tests for components 1–3 pass)
1. packages/catalog: ingest data/products.json + CSVs. Normalise per section 5 row 1. FTS on fi/en names. getSubstitutes from explicit substitutions.
2. packages/feasibility: implement conversion and checks per section 5 row 3. Tests: 1,000 L → 1000 ST → 100 KI; lot size violation; past cut-off; empty scheduleLines; 999999 terminal.
3. packages/valio-client: price + availability adapter with the request shape in PLAN.md; replay mock reading fixtures when MOCK_VALIO=true.

Phase 2 — the door (stop when Claude Desktop connects with only the URL)
1. apps/gateway: Hono app, MCP server (Streamable HTTP) with search_catalog and get_offers; REST mirror; OpenAPI via zod-openapi.
2. packages/signing: JWS Ed25519 for offers (validUntil rule in section 6); RFC 9421 verification middleware; bearer fallback behind ALLOW_BEARER.
3. Discovery: /.well-known/aimo-agent.json, agent-card.json, jwks.json per section 7.
4. Write docs/claude-desktop.json config and test the connection.

Phase 3 — decisions (stop when AUTO, HOLD and REFUSE each have a passing test and a ledger trail)
1. packages/rules: implement the rule table in section 8 as data + one evaluator. One test per rule. Fired rules carry id, message, observed, limit.
2. submit_proposal, get_proposal, get_order tools + REST. Order service creates mock orders; delivery date from availability line.
3. packages/ledger projections: timeline(agentId), feed(customerId), verify().
4. Run the reference scenario end to end with MOCK_VALIO=true and record the output in PROGRESS.md.

Phase 4 — approval (stop when a HOLD is approved from the card and the order appears)
1. Approval service: state machine, pg-boss jobs, channel order, timeouts, amended re-evaluation with challenge token.
2. Approval card route in apps/web; SMS link via Twilio.
3. Partial auto-approval behind ALLOW_PARTIAL_AUTO.

Phase 5 — voice (stop when a real call records a decision; skip if VOICE_ENABLED=false)
1. apps/gateway/workers/voice: Twilio outbound + Media Streams bridged to Gemini Live; fixed script; function calls approve / approve_with_amount / reject / callback; PIN check in code; read-back; fallback to SMS.
2. Store transcript + recording ref on the Approval and in the ledger.

Phase 6 — screens (stop when all five screens render with fixtures and the approve flow works without reload)
1. Tokens, fonts and restyled primitives in packages/ui per section 11.
2. Agent access, Awaiting approval, Order detail + ledger timeline, Aimo admin (dark), Discovery page.

Phase 7 — buyer + polish
1. apps/buyer-agent with Claude Agent SDK: read data/inventory.csv, build Requirement, call the door, build Proposal with packages/feasibility, submit, poll, print the plain-language result. Optional: Gemini Flash cross-check before submit.
2. packages/peppol: Order T01 XML from an Order; link from order detail.
3. pgvector + gemini-embedding second-stage search.
4. docs: ASSUMPTIONS.md, README with run instructions, openapi.json committed.

Definition of done for the weekend
- `pnpm demo` runs the four-line scenario against MOCK_VALIO=true and prints: offers, substitutes, verdict, approval, order id, ledger verify OK.
- Claude Desktop connects to the deployed MCP URL and completes search → offers → proposal.
- Awaiting approval card approves a held proposal; the order and ledger update live.
- At least one voice approval recorded, or VOICE_ENABLED=false documented in ASSUMPTIONS.md.
```

For Codex, the same text works as `AGENTS.md`; split phases into separate tasks and ask it to open a PR per phase so a teammate can review while the next phase runs.

## Demo video, risks and production path

The video must show the full loop on the mocked environment, the controls doing their job, and a stranger's agent using the same door. Capture each shot as soon as its feature works; do not wait for the end.

- [ ] Agent access: register the agent, set the mandate, save (shows JSON)
- [ ] Trigger: inventory CSV → requirement printed by the buyer agent
- [ ] Offers: signed offer JSON with price validity and cut-off; "Verified by Aimo" mark in the UI
- [ ] Substitutes: fish short, yoghurt blocked → good-better-best with trade-off sentence
- [ ] AUTO: milk and butter placed immediately, ledger entries appear
- [ ] HOLD: fish + total exceed mandate → phone rings → approve 100 kg by voice → order placed → SMS confirmation
- [ ] REFUSE: a scripted bad proposal (50,000 pieces, non-lactose-free swap) refused; Aimo admin feed shows the rule in red
- [ ] Claude Desktop: paste the MCP URL, ask for lactose-free milk, proposal lands in Awaiting approval
- [ ] Ledger verify OK; Peppol XML opened

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Valio base URL unknown or 403 at kickoff | high | Replay mock from day one; swap `VALIO_BASE_URL` when access works |
| Net content missing from product records | medium | Parse from name, flag `inferred`, show the flag in the proposal |
| Telephony fails at the venue | high | Record the call early; SMS + card path independent of voice |
| Claude Desktop cannot sign RFC 9421 | certain | Bearer fallback behind `ALLOW_BEARER`; signing demonstrated by the reference agent |
| Team builds buyer-side features | medium | Buyer scope is frozen to CSV trigger + reference client |
| Rules engine grows prompts | low | Rule table is data; CI test fails if the rules package imports any model SDK |

Production path for Valio (one slide):

1. Replace the mock order service with the real order API and ERP confirmation; keep the proposal/verdict/approval objects unchanged.
2. Move agent registration into the real customer account and SSO; approvers become existing webshop users.
3. Publish the discovery profile and OpenAPI on valioaimo.fi; register in UCP/A2A directories when they accept B2B sellers.
4. Issue customer mandates as verifiable credentials so a third-party agent platform can carry proof of authority.
5. Feed the ledger into existing audit and BI; keep the hash chain.
6. Extend the rules table with Aimo's commercial policy (credit limits, contract assortments) without touching the engine.

Assumptions to state in the README: synthetic data only; prices are customer-scoped as returned by the mock; order placement is simulated; carbon per order uses L→kg 1.03 for dairy liquids; reliability is a historical signal, not a guarantee.
