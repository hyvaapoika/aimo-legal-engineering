# Aimo Agent Gateway

## Legal engineering portfolio

Team fatbois built the original purchasing gateway at Junction. This fork adds an optional supplier-evidence check by `@hyvaapoika`. It shows what happens when a kitchen manager is ready to approve a €120 pasta order and the supplier withdraws its egg declaration. Run `pnpm demo:food-evidence` to replay it. [Rule and legal source](docs/food-evidence.md) · [Regression tests](tests/food-evidence.test.ts) · [Original team gateway](https://github.com/safiulalam99/junction-repo/tree/c09f98678980bf7004bd9c2e2f89ef5f6a5402f9)

## Junction gateway

A working Junction 2026 purchasing gateway over the supplied Valio Aimo catalog. External agents search products, obtain signed fixed-price offers, and submit proposals. Deterministic rules produce **AUTO**, **HOLD**, or **REFUSE**. A registered human can approve policy exceptions through the webshop; impossible quantities, blocked products, missing claims, and invalid offers cannot be waved through.

**Local demo is implemented and tested. Order placement is simulated. Valio's hosted challenge APIs also use synthetic data and require your API key. Voice and SMS are disabled; no messages or calls are sent.** See [challenge fit](docs/CHALLENGE-FIT.md) for the judging criteria and [implementation decisions](docs/ASSUMPTIONS.md) for the exact departures from the original plan.

## Run

Use Node 22 and pnpm 11.25.0. Node 20.19+ also works with the checked-in versions.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Open [the purchasing workspace](http://localhost:3100) and select **Enter local demo workspace**. The gateway runs at [localhost:4000](http://localhost:4000/health). Port 3100 avoids another application already using 3000 on the development machine.

Click **Run purchase demo**. It creates:

- A €190 in-mandate order for milk and butter.
- A €4,042 four-line replenishment proposal with yoghurt and fish substitutions, held for approval.
- A fish quantity exception that must be amended before approval.
- A refused purchase of sales-blocked yoghurt.

Approve the replenishment request, open its order, inspect the timeline, and verify the ledger. All product names and pack metadata come from the supplied files. Mock prices and availability are explicitly synthetic fixtures.

No provider key or Docker daemon is needed for this path. Embedded PostgreSQL, signing keys, and the reference buyer key persist in ignored `.local/`. **Run only one gateway against an embedded database directory.** Use external PostgreSQL for multiple gateway instances. Stop the gateway before using the standalone ingest command against that same embedded directory.

## Commands

| Command                           | Purpose                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                        | Gateway, persisted approval worker, and Next.js interface                                                  |
| `pnpm demo`                       | Isolated full scenario, approval, order, and ledger verification; cleans its temporary database            |
| `pnpm buyer`                      | Signed inventory-driven buyer; verifies offers, resolves feasible substitutes, submits, and reports status |
| `pnpm buyer --wait`               | Also poll the proposal for a human decision, for up to ten minutes                                         |
| `pnpm buyer:claude`               | Optional Claude Agent SDK buyer over MCP; needs `ANTHROPIC_API_KEY`, with a $2 run budget                  |
| `pnpm buyer:review <proposal-id>` | Optional Gemini advisory review; needs `GEMINI_API_KEY`; cannot change or approve anything                 |
| `pnpm ingest`                     | Populate PostgreSQL catalog JSONB records and its full-text index                                          |
| `pnpm schemas`                    | Regenerate the nine published domain schemas, OpenAPI, and discovery example                               |
| `pnpm test`                       | Domain, data, signing, service, HTTP, and real MCP SDK integration tests                                   |
| `pnpm typecheck`                  | Strict TypeScript checks for all applications and packages                                                 |
| `pnpm check`                      | Typecheck, tests, and isolated end-to-end demo                                                             |
| `pnpm build`                      | Typecheck and production Next.js build through Turborepo                                                   |
| `pnpm start`                      | Start the gateway and built webshop; set production credentials first                                      |

## Connect Valio's hosted mock backend

Edit `.env` locally:

The adapter name `LiveValioClient` and `MOCK_VALIO=false` mean HTTP calls to the hosted challenge service, not production supplier data or real order fulfillment.

```dotenv
MOCK_VALIO=false
VALIO_BASE_URL=https://junction26.valioaimo.fi
VALIO_API_KEY=<key from Junction platform>
DEMO_MODE=false
ADMIN_TOKEN=<distinct random value of at least 32 characters>
AGENT_TOKEN=<distinct random value of at least 32 characters>
```

Restart both servers. Sign into the web interface with `ADMIN_TOKEN`. `VALIO_API_KEY` stays in the gateway and is sent as **`X-API-Key`** to Valio. It is never included in the web bundle, agent token, discovery documents, logs, or ledger. The live adapter calls `/api/price` and `/api/availability` exactly once each per shortlist of at most 1,000 products. It does not scrape all dynamic prices, automatically retry rate limits, or silently replace live failures with mock prices.

The two authentication layers are separate: Valio's `/api` uses `X-API-Key`; this gateway's `/v1` and `/mcp` use registered agent signatures or its optional bearer fallback. `/admin` requires the separate human/admin credential. The web `/api` routes use an HttpOnly session cookie and same-origin mutation checks.

## ElevenLabs voice setup

ElevenLabs onboarding stores `ELEVENLABS_API_KEY` in the ignored root `.env.local`. The server-only SDK client loads that file without printing credentials. Run `pnpm voice:setup` to create the private English-language quotation assistant, or `pnpm voice:check` to verify an existing project agent. Its ID is stored in ignored `.local/elevenlabs-agent.json`. These commands do not place calls or generate speech.

This is provider setup, not completed voice approval: the agent has no approval tool or telephone connection yet and explicitly says it cannot record decisions. The gateway's `VOICE_ENABLED` flag remains disabled. See [voice integration plan](docs/VOICE-APPROVAL-PLAN.md), including the Twilio trial's audio-streaming restriction.

## Connect another agent

Discovery: [localhost:4000/.well-known/aimo-agent.json](http://localhost:4000/.well-known/aimo-agent.json). REST specification: [localhost:4000/openapi.json](http://localhost:4000/openapi.json). Public key: [localhost:4000/.well-known/jwks.json](http://localhost:4000/.well-known/jwks.json).

The MCP endpoint is `http://localhost:4000/mcp`, with Streamable HTTP and these tools:

```text
search_catalog → get_offers → submit_proposal → get_proposal → get_order
```

For a client that supports an HTTP MCP server with headers, supply `Authorization: Bearer <agent-token>` and set `ALLOW_BEARER=true`. For Claude Desktop's local stdio configuration, copy [docs/claude-desktop.json](docs/claude-desktop.json), replacing `<absolute-repository-path>`. The included bridge reads the repository `.env` and exposes only the same five purchasing tools. It cannot access admin approvals. Remote connectors that cannot reach localhost require a publicly reachable HTTPS gateway. A URL alone is deliberately insufficient to bypass agent authentication.

The reference CLI uses Ed25519 HTTP Message Signatures: `@method`, `@target-uri`, and `content-digest`, plus `created`, `expires`, `nonce`, `keyid`, and `alg` parameters. Covering the target URI also protects query parameters. Nonces are stored transactionally, and signatures expire after five minutes. This is a documented restricted RFC 9421 profile, not an implementation of every possible signature component combination.

## Repository map

```text
apps/gateway/src/       HTTP/MCP, commerce lifecycle, approval queue, discovery
apps/web/app/           Webshop and human-session proxy; small UI components
apps/buyer-agent/src/   Signed buyer, deterministic planner, model clients, stdio bridge
packages/schema/       Runtime schemas, inferred TypeScript types, published JSON schemas
packages/catalog/      Supplied JSON/CSV normalization, search, safe candidates
packages/feasibility/  Decimal unit/pack conversion, availability and cut-off rules
packages/rules/        Model-free authority, policy, feasibility, and anomaly rules
packages/signing/      Ed25519 JWS and restricted RFC 9421 request profile
packages/database/     Parameterized PostgreSQL repository and serialized transactions
packages/ledger/       Canonical hash-chain append and verification
packages/valio-client/ Live contract adapter and deterministic mock scenarios
packages/peppol/       Escaped UBL Order XML export for demonstration
data/                  Original supplied data, inventory trigger, labelled mock fixtures
tests/                 Behavioral and regression tests
docs/                  Original plan, API contracts, assumptions, and demo runbook
infra/                 Optional PostgreSQL compose file and application Dockerfile
```

To repeat the external database check, set `TEST_DATABASE_URL` to a disposable PostgreSQL instance and run `pnpm test:postgres`. The script creates and removes its own isolated schema.

## Storage and deployment

The default PGlite engine runs PostgreSQL locally without a service. To use external PostgreSQL:

```sh
docker compose -f infra/docker-compose.yml up -d
```

Set `DATABASE_URL=postgres://aimo:local-development-only@localhost:5432/aimo`. Tables and indexes are created idempotently on startup; spend checks, proposals, decisions, order insertion, and ledger writes share a transaction. External PostgreSQL uses a transaction-scoped advisory lock across gateway instances. This favors correctness and a clear demo over high throughput.

For a container image, run `docker build -f infra/Dockerfile -t aimo-gateway .`. The Railway judge sandbox is configured in `.railway/railway.ts`; deployment steps and server-side secret handling are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). It serves the complete supplied catalogue and can use Valio's hosted challenge lookup API for synthetic prices and availability. Every proposal and order remains in this app's simulated ledger. The public sandbox is shared and grants demo approval access; it is not a production customer workspace. Use distinct credentials, durable storage, and real buyer authentication/tenant isolation before real customer use.

## Verification and evidence

The test suite covers every main rule, whole-piece and pack conversions, unknown data, upstream request shape, signed-body tampering, changed query strings, request replay, tenant isolation, buyer/admin separation, idempotent retries, concurrent approvals, amended quantities, expiry, ledger tampering, and a real MCP SDK purchase flow. The browser flow has also been exercised at desktop and mobile sizes.

[PROGRESS.md](PROGRESS.md) records verification results. [docs/DEMO.md](docs/DEMO.md) is the presentation walkthrough. [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) identifies all optional features and external checks that remain disabled or unverified.
