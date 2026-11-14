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

Scope: local working hackathon application. Live provider checks and public deployment need credentials/configuration and are recorded separately from local verification.

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

## External and optional boundaries

- Live Valio calls await `VALIO_API_KEY`. No authentication bypass or mock fallback is used in live mode.
- Claude and Gemini adapters are implemented/typechecked; paid calls were not made without keys.
- Voice/SMS are disabled and are not represented as working integrations. The plan explicitly permits the `VOICE_ENABLED=false` path.
- Partial auto-placement, vector search, A2A task execution, production SSO, and certified Peppol validation are outside this delivered local demo. See `docs/ASSUMPTIONS.md` for precise behavior and rationale.
- No public deployment, remote push, real order, payment, email, SMS, or phone call was made.
