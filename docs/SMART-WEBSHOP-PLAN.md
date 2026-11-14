# Valio Aimo smart webshop — implementation plan

Date: 14 November 2026. Status: implementation plan; the features below are not yet implemented or verified. This supersedes the lunch-first interaction proposal in CHEF-PURCHASING-PLAN.md. The user has requested a Valio-like webshop with useful AI-assisted discovery across the supplied catalogue.

## 1. Product decision

Improve the familiar search → products → compare → cart journey. The main screen is a webshop, with real catalogue products and optional contextual assistance. A recipe, chat session, portion count, or AI request is never required to shop.

Keep the current gateway, signing, mandatory human approval in the demo, simulated ordering, and ledger. The chef/buyer interface and external purchasing agents will use the same discovery and purchasing services. Do not replace challenge-required agent interfaces with a browser-only experience.

The fixed ten-product pasta preview will leave the homepage. Preserve it in Git; do not spend further effort extending its hard-coded request matching. Keep Operations available to demonstrate approval and traceability.

## 2. Observed baseline and design reference

Reference: https://www.valioaimo.fi/tuotehaku/?sivu=2

The public catalogue was inspected in the browser on 14 November. It showed 16,753 products, search, filters for product groups, manufacturers, Valio brands, product properties, ingredients and packaging, and photographic product cards. Searching `kerma` showed 850 results, including cooking cream, toffee, ice cream, prepared potatoes and equipment. This establishes an example of ambiguous search; it does not establish how authenticated webshop ranking works.

The public cooking-cream detail page links to Toimitustukku for ordering. We have not inspected authenticated private shopping screens. Treat the public catalogue as the visual reference and the supplied challenge contract as the integration reference. Do not claim this is a deployed modification to Valio's real site.

Visual direction:

- Valio Aimo's dark teal navigation, white surfaces, lime accents, compact category controls, clear product photography, and strong heading style.
- Use an authentic publicly available logo/brand asset when its source is verified. Use available licensed typography; do not fabricate an official font or logo.
- The functional webshop starts with a prominent search bar and categories, not our current lunch hero. Keep a compact branded introduction rather than a large decorative banner that pushes shopping below the fold.
- Desktop: search and filters above a responsive 3–4-column product grid, with a cart button/count and an optional cart drawer. Comparison uses a tray and drawer. No permanent chatbot panel consuming product space.
- Mobile: visible search, horizontal refinement chips, a filter sheet, two-column product cards where readable, and an accessible cart action. Compare becomes stacked cards with matching labels.
- Product cards: photo/fallback, actual name, brand, sales pack, declared properties, current price and comparison price when available, availability state, quantity and Add. Product details expand without losing search position.
- Show no unsupported “best”, “popular”, “your usual”, or “available” badges. Avoid explanations on every card; show a short reason only when it helps discriminate results.
- English demo copy with Finnish/English product search, original supplier names available, and locale-aware rendering. Full Finnish UI translation is a later deliverable unless requested.

## 3. Data we can actually use

The repository product JSON was checked against the supplied original and is identical. The dataset count differs from the live public site; do not present the public count as the count in our app.

| Data | Verified coverage | Use |
| --- | ---: | --- |
| Product records | 17,546 | Full searchable assortment |
| Finnish / English names | 17,546 / 17,544 | Names, exact and bilingual lookup |
| Category codes | 349 distinct | Filtering; readable taxonomy requires a mapping |
| Nonempty brand | 14,463 | Brand filters and product cards |
| Marketing descriptions | 11,915 | Purpose-oriented retrieval and evidence |
| Ingredient text (`keyIngredients`) | 14,047 | Detail inspection and secondary retrieval |
| Preparation instructions | 3,480 | Sourced cooking-use attributes |
| Usage instructions | 3,694 | Sourced intended-use hints |
| Nutritional content | 12,251 | Comparison when measurement bases match |
| Media references | 13,375 products | Resolve via a verified media service |
| Primary media reference | 11,981 products | Select a preferred image when accessible |
| Supplier substitution lists | 189 products | Explicit alternative candidates |
| Carbon / historical reliability | 11,033 / 4,425 products | Optional signals with missingness disclosed |

Presence is not completeness or correctness. Preserve source text, units, language, date and missing values. Distinguish unsupported, unknown, and contradictory declarations. Absence never proves free-from status. Reliability is historical, not an arrival guarantee; carbon values retain their kg CO2-eq/kg basis.

### Images and taxonomy

`data/product-schema.json` explicitly excludes media files. `synkkaData.medias` contains numeric IDs and a primary flag, with no image URLs. The supplied API has no media route.

Request from Valio: “Can you provide the media endpoint or CDN URL mapping for synkkaData.medias[].id, and the category-code/name hierarchy used by the webshop?” Do not send this message automatically.

Build a media resolver with provenance and states: verified, absent, unavailable. Verify product/GTIN and packaging identity when mapping public assets. Never manufacture image URLs or generate replacement packaging with AI. Do not equate every media reference with a usable product image. Preserve the existing verified photo mappings as a small fallback, not catalogue-wide coverage. Validate content type, file size and approved hosts if proxying images; no arbitrary user-controlled URL fetching.

Use official taxonomy when available. Otherwise create a versioned, reviewed broad product-type mapping from the supplied records, with Unknown/Other as explicit states. AI may propose labels; uncertain labels are not supplier facts or substitution eligibility. Category codes alone must not become invented customer-facing category names.

## 4. Technical architecture

Keep Next.js/React, Hono/TypeScript, Zod and the existing PostgreSQL/PGlite setup. Extend the current backend instead of introducing a second procurement system.

Create `packages/discovery` for intent interpretation, search retrieval, ranking, evidence, comparisons and alternatives. Keep catalogue normalization in `packages/catalog`; provider price/stock access in `packages/valio-client`; buying permissions and transactions in their existing packages.

### Data/index pipeline

1. Preserve original records and extend normalized products with multilingual descriptions, ingredient text, usage/preparation/storage instructions, origin, nutrition, media references and source paths.
2. Build deterministic product search documents. Weight identifier/name/product type most strongly, brand next, and marketing/ingredient mentions more weakly. A mention of cream in a dessert must not establish that the product is cooking cream.
3. Store structured searchable attributes and language-aware full-text fields. Use PostgreSQL full-text search, trigram matching for typos, and a curated versioned synonym map for English/Finnish domain terms.
4. Generate multilingual text embeddings for product documents. Record content hash, model, dimension and document-format version. Re-embed changed content only, with resumable batches. Do not embed prices, customer-specific offers or transient stock into the static index.
5. Store vectors in pgvector. Validate extension compatibility with our installed PGlite version on an isolated database before migration. Use exact vector search initially at this catalogue size; add an approximate index only if measured latency requires it.
6. Search reads should not queue behind the repository's serialized commercial transaction chain. Maintain a separate read-oriented discovery interface/store, with atomic version activation after indexing completes.

No separate managed vector service, model training, fine-tuning or multi-agent swarm is needed for the first release. Preserve SQL parity and parameterized queries across local and PostgreSQL execution.

### AI providers and bounded calls

- Gemini through the existing `@google/genai` dependency for structured intent extraction. Configure and smoke-test an available Flash model on the actual account, then pin the verified model identifier in configuration.
- Initial text embedding candidate: `gemini-embedding-001`; confirm access, supported dimensions and retrieval task settings in a small smoke test. Start with 768 dimensions if supported and normalize according to the model documentation. Pin model/dimension together; never mix embeddings from different versions.
- Exact product ID/GTIN lookup bypasses AI. Basic typing returns deterministic suggestions; call interpretation/semantic search on submitted descriptive queries, not on every keystroke.
- At most one intent call and one query-embedding call for a normal smart search; cache by normalized query, explicit constraints, index and model version. Use request cancellation and ignore stale responses.
- Index 50 representative products first, inspect token/quota usage, then run bounded, resumable indexing within configured allowance. Never enable billing or upgrade an account as part of this work. Set timeouts, retry limits and indexing/query budgets.
- Missing key, timeout, quota or provider failure leaves working keyword search. Show a concise “Basic search” state when semantic enhancement is unavailable; never present hard-coded output as live AI.

### Query and ranking pipeline

For “lactose-free cream for cooking, around one litre”:

1. Return validated intent: product type/use, hard dietary restriction, soft preferred pack amount, and language. Do not interpret “around” as an exact hard equality.
2. Render understood constraints as removable chips; distinguish requested hard restrictions from preferences. Unsupported or ambiguous hard constraints must be shown as unresolved, not silently dropped. A broad “cream” query can offer Cooking / Whipping / Plant-based refinements without blocking ordinary results.
3. Retrieve lexical and semantic candidate pools with hard filters applied before candidate truncation. Fuse ranked lists using deterministic reciprocal-rank fusion; boost exact identifiers/names and verified product-type matches. Calibrate on the evaluation set, not subjective screenshots.
4. Revalidate required declarations and conflicts. Unknown does not satisfy a hard dietary claim. Ingredient text supports inspection, not a model-inferred allergen-free label. Negative requests and compound restrictions get explicit parsing tests.
5. Return paginated real products, query-level facet counts, short evidence-backed reasons and unresolved constraints. Each reason records product ID plus source field/value; avoid unverifiable model confidence percentages.
6. Batch challenge price/availability lookup for visible/shortlisted candidates in the selected customer and delivery context. Refresh the visible result when responses arrive without unexpectedly shuffling the grid.
7. Apply explicit price/availability sorting to a fully evaluated bounded result set or disclose its shortlist scope. Do not label a partial-price shortlist “cheapest in the catalogue.” Unknown/unpriced products form a distinct state.

No-match results explain which required constraints cannot be verified, and offer separately labelled choices to revise them. Never quietly relax a requirement or insert near matches into the valid-results grid.

### Comparisons, alternatives and contextual suggestions

- Compare 2–3 selected products: sales unit/case contents, price, legal purchase total, comparable unit price, declarations, intended-use evidence and known availability. Offer detailed nutrition/carbon/reliability only when useful and supported.
- Convert €/kg or €/L only with verified corresponding units and known pack contents. Do not assume density, yield, or equivalence between 100g and 100ml nutrition bases.
- Alternatives: supplier-listed candidates first, followed by candidates with reviewed product-type/use compatibility. Shared category or semantic similarity is retrieval evidence, not proof of interchangeability. Preserve hard restrictions and check stock/date eligibility separately.
- Given a requested amount, show replacement sales-pack quantity, total price difference and excess amount. An unknown conversion requires manual quantity selection; it must not produce a fabricated comparison.
- Provide refinements from actual facets, evidence-backed similar products, and appropriate alternate pack sizes. Skip “customers also bought”, “popular”, and personalized replenishment until real history exists.
- One customer-selected replacement updates the same cart. Keep the original until selection and support Undo. No silent swaps or unrequested cart additions.

### UI/API contract and access

Use a small typed result contract, not arbitrary AI-generated HTML. Proposed new interfaces (final names checked against existing routes during implementation):

- `POST /v1/discovery/search`: query, explicit filters, sort, cursor and authorized shopping context → products, facets, refinements, evidence, provider/index mode and query revision.
- `POST /v1/discovery/compare`: 2–3 known product IDs and context → normalized facts and commercial comparison.
- `POST /v1/discovery/alternatives`: source ID, requested quantity/unit and constraints → candidate alternatives and checked differences.

Keep `/v1/catalog/search` backward-compatible for existing clients. Expose equivalent discovery capabilities through existing MCP tooling, with additive schema changes and contract tests.

A scoped storefront server proxy uses the buyer's catalog/offer permissions. It must not forward the admin token merely because the current Operations proxy does so. Customer and destination come from authenticated/session context, not untrusted model output. Separate public catalogue browsing from customer-specific offers. Keys stay server-side; no provider or approval credentials in the browser or Git. Cache customer prices by customer, destination, requested date and validity; never share them across customers.

Direct UI controls and structured assistant actions use the same server-validated draft operations. Draft changes carry a revision; stale proposals cannot overwrite newer manual edits. A clearly marked demo buyer profile may be used locally. Connecting cart → signed offer → held proposal → authenticated human approval → simulated order must use the existing deterministic transaction/ledger code. Client-side totals are explanatory, not purchasing authority.

## 5. Build sequence and completion gates

| Phase | Work | Acceptance gate |
| --- | --- | --- |
| 1. Full catalogue and data contracts | Extend normalized schema, provenance, taxonomy mapping, image resolver interface, paginated discovery query; retain existing source data | All 17,546 records reachable; audited missingness retained; exact ID/GTIN works; no hard-coded ten-product list |
| 2. Valio-style webshop foundation | Branded header, search, filter chips/sheet, real catalogue grid, detail drawer, compare tray, cart drawer; query/filter state in URL | Desktop and mobile usable with keyboard; back/forward restores search; no overflow; basic search/cart works without AI |
| 3. Smart discovery | Keyword/trigram baseline, Gemini intent, embeddings, hybrid retrieval, sourced reasons, facet refinements and graceful fallback | Bilingual intent/typo benchmark improves over baseline; no unsupported dietary match; actual provider calls and failure fallback exercised |
| 4. Compare and replace | Comparable facts, live challenge offers, availability states, candidate compatibility, quantity/price consequences and Undo | Units/unknown-stock boundaries pass; no unsupported cheapest claim; replacement preserves restrictions and needs explicit selection |
| 5. Cart and agent integration | Shared scoped search/compare tools, revisioned draft, offer refresh, existing human approval and simulated order | One browser journey and one external-agent journey use the same services; human/buyer separation and ledger verified |
| 6. Polish and evaluate | Relevance tuning, image coverage verification, loading/empty/error states, accessibility, performance and demo evidence | All required checks pass; measured report separates actual provider integrations from fixtures and remaining gaps |

Image resolution runs alongside phases 1–3. Missing official media access does not block search engineering, but catalogue-wide real photography remains explicitly incomplete until a verified source is available. No fabricated URL mapping, universal stock fixture or sample-price default will hide that gap.

The first reviewable milestone is a Valio-like catalogue showing the full data with working search, filters and cart. Smart search is added to this same screen; no further lunch-workspace redesign.

## 6. Verification and evaluation

Create a reviewed set of 40 queries before tuning: 8 exact ID/GTIN/name queries, 8 Finnish/English equivalent requests, 8 typos or ambiguous product-type queries, 8 dietary/negation/conflict requests, and 8 pack-size/use/no-match requests. Label relevant product IDs and required attributes from supplied records. Keep a held-out subset; AI is not the sole relevance judge.

Demonstration queries include `kerma`, cooking cream vs whipping cream, lactose-free milk, gluten-free pasta, a product identifier, a spelling error, no verified matches, and a supplied stock-out scenario. Record the basic-search baseline before changing ranking.

Proposed targets, not measured results:

- All valid exact identifiers resolve correctly.
- At least 90% of answerable benchmark queries contain a suitable product in the top five; report by query class and identify uncertain labels.
- Zero hard-restriction violations and zero unsourced recommendation claims in the reviewed test set.
- Warm local basic-search p95 below 300ms; smart result target below 3s, measured separately from price/stock latency. Preserve immediate usable results if enrichment misses its deadline.
- A small paired usability test measures time to first correct cart addition, reformulations, detail pages opened, successful replacements and user understanding against basic search. Do not claim UX improvement before measuring it.

Regression coverage: missing/conflicting free-from declarations, unknown stock sentinel 999999, blocked products, date/quantity mismatch, variable-weight/multipack conversions, non-comparable units, unavailable prices, source prompt injection, forged product IDs, stale query and cart revisions, cross-customer caching, rate-limit/timeout fallback, and unauthorized approval.

Run `pnpm check` and `pnpm build` for purchasing-flow changes. Run relevant PostgreSQL parity checks when migrations or transaction paths change. Browser-test actual flows at desktop and 390px mobile widths. Track total embedding coverage, verified image coverage, failed items and actual provider checks in PROGRESS.md and docs/ASSUMPTIONS.md.

## 7. External inputs and deliberate deferrals

Needed from Valio: media-ID retrieval/mapping; readable category taxonomy; clarification of customer/delivery context supported by challenge endpoints. Future personalization needs real order history, consented customer preferences and contract assortment data. Existing public claims about Aimo recommendations are not evidence of their absence in private screens.

Deferred: arbitrary recipe generation, mandatory phone calls, POS/ERP integrations, model fine-tuning, collaborative filtering without history, paid managed vector services, autonomous substitutions and public deployment. These do not block a credible smart catalogue demonstration.

The challenge API is a synthetic supplier backend; real supplier fulfilment is not established. The plan preserves human approval and simulated ordering. Research and documentation have been performed; new embeddings, search providers, media retrieval and new UI have not been implemented in this planning turn.

## Sources and relevant code

- Public catalogue: https://www.valioaimo.fi/tuotehaku/?sivu=2
- Observed cream search: https://www.valioaimo.fi/tuotehaku/?haku=kerma
- Product information and webshop handoff: https://www.valioaimo.fi/ammattilaistuotteet/valio-ruokakerma-15-laktoositon-uht/
- Gemini structured outputs: https://ai.google.dev/gemini-api/docs/structured-output — schema-constrained interpretation still requires application validation.
- Gemini embeddings: https://ai.google.dev/gemini-api/docs/embeddings — text retrieval embeddings; validate chosen model access and settings before indexing.
- PGlite extensions: https://pglite.dev/extensions/ — pgvector support is documented; installed-version compatibility remains to be tested.
- `data/product-schema.json`, `data/products.json`, both supplied CSVs and `docs/valio-openapi.json` are the data/contracts audited above.
- `packages/catalog/src/index.ts`: current normalization and substring search to extend.
- `packages/database/src/index.ts`: existing JSONB/full-text structures and serialized commercial transactions.
- `packages/valio-client/src/index.ts`: existing challenge price/availability adapter.
- `apps/gateway/src/http.ts`, `mcp.ts`, `service.ts`: authorization and shared service integration.
- `apps/web/app/kitchen/*`: superseded fixed-product prototype; `apps/web/app/operations/page.tsx`: retained purchasing controls.
