# Smart webshop: local demo

Run `pnpm dev` from the repository, then open http://localhost:3100. The homepage uses the full supplied catalogue; `/operations` keeps the existing purchasing controls.

## Show the customer journey

1. Start typing **I'm making pasta for 80 people**. Recipe cards update without pressing Enter or waiting for a model. Choose **Tomato & basil pasta**.
2. The ingredient workspace scales the published recipe. Say **Make it for 120 people. I already have pasta and carrots.** in the same input. Portions update and those ingredients are excluded from the shopping selection.
3. Review products and pack quantities. Missing quantities and unverified conversions need a manual choice. **Add selected items** adds only ready rows; it does not quietly treat the whole recipe as complete.
4. Clear the input and type **lactose-free cooking cream, 1 litre** to use the full catalogue. Product suggestions arrive first, with background intent/semantic refinement after an idle pause. Compare products, inspect supplier declarations, and edit the basket normally.
5. Click a product such as **Barilla 5kg Fusilli dry pasta**. **Goes well with this** shows sauce, grated cheese and fresh basil with individual Add buttons. Add one and check that it enters the basket and its suggestion group disappears. Undo is available.
6. Alternatives appear automatically: product details show one option, and basket/recipe rows highlight a verified replacement or lower total. Review pack count, extra contents and total before **Swap**; **Undo last basket change** restores the previous selection. No “Find alternatives” step remains.
7. **Request human approval** refreshes signed offers and submits a proposal. The separate Operations login handles review; no order is placed directly from the shopping controls.
8. Save a basket to reuse it. Only actual saved baskets in this browser contribute to recipe/product preference ranking. There is no imported customer order history.

Three verified public Valio recipes are available; this is not yet a complete recipe bank. Recipe sources are linked within the workspace. Sample-price labels remain next to monetary figures because the current supplier adapter is mocked.

The checkout demo submitted a three-piece, one-litre cream basket (€10.47 in mock prices) and received `held`, including mandatory human approval. No supplier fulfilment was attempted.

## Search setup

- Immediate `/v1/discovery/suggest` uses in-memory catalogue matching and deterministic requirement filters, independent of the database/index/provider. Six local proxy requests measured 20–73 ms; the input adds a 180 ms debounce. Recipe cards match locally on every input change.
- Background full-text/trigram search works without provider credentials or embeddings. It begins after 900 ms idle, never blocks immediate results, and offers an explicit refresh if the user has already interacted with the current matches.
- Optional server-side `GEMINI_API_KEY` enables structured interpretation. `DISCOVERY_MODEL` defaults to the account-tested `gemini-3.5-flash-lite`. The provider requires at least a ten-second deadline; this adapter uses twelve seconds. Product facts and purchasing decisions never come from its output.
- `pnpm index:search` embeds up to 50 uncached products. `INDEX_LIMIT=17546 pnpm index:search` processes the complete remaining catalogue. It resumes from content-hash/model-validated JSONL in `STATE_DIR` (default `.local`). `DATA_DIR` defaults to `data`.
- Embeddings use public `Xenova/paraphrase-multilingual-MiniLM-L12-v2` locally, quantized q8, 384 dimensions, mean pooling, normalized vectors, 128-token maximum. The model weights download on first use; no cloud embedding key is required. Model/config version is recorded with each vector.
- All **17,546** records were embedded locally on 14 November. The index activates only when every current product has a matching vector. Partial batches never bias search toward the subset already embedded.
- Search uses a separate in-memory PGlite/pgvector store. It rebuilds from catalogue data and cached vectors after gateway restart. A measured first hybrid browser search took about 25 seconds in the previous UI. This cold setup still exists in the background, but the immediate suggestion path no longer waits for it. No production search hosting or PostgreSQL search-store adapter is claimed.
- Gemini embeddings were tested first, then stopped at a quota response after 146 records. Those vectors are not mixed with the local index. No billing upgrade was made.

## Data and integration limits

There are five verified product-photo mappings. Other cards say **Image unavailable**. The user confirmed no image endpoint is available; numeric media IDs remain preserved for later mapping. See `apps/web/public/kitchen/sources.json` and `apps/web/public/store/sources.json` for asset provenance.

Broad navigation groups and supported product types are application heuristics, not Valio's official taxonomy. Alternatives are supplier-listed or same-type/category candidates, not proof that two ingredients behave identically in a recipe. Required declarations are preserved, and the user chooses each swap.

Prices and availability in this browser verification used the existing **mock** Valio adapter. The real challenge adapter remains available, but live challenge price/availability was not exercised in this implementation. Missing stock, prices, and conversions remain unknown; `999999` never means confirmed inventory.

The `/api/shop` proxy is an explicit localhost development buyer session. It does not forward the admin credential, rejects cross-origin mutations, and is disabled in production. Public deployment requires real buyer authentication. Commercial writes retain the existing transactional database, signing, rules and ledger.

## Reproducible checks

- `pnpm check`: TypeScript, domain/regression/HTTP/MCP tests and the purchasing demo.
- `pnpm build`: production compilation; the local-only proxy remains disabled under production runtime.
- `pnpm evaluate:search` and `pnpm evaluate:search --semantic`: fixed 40-case challenge smoke benchmark. These isolate local retrieval by disabling Gemini calls within the evaluation process.
- `pnpm exec tsx scripts/evaluate-discovery.ts [--semantic]`: additional 40 common product-name queries.

Reports are written under `.local/`. The common-query suite found a name-matching top-five result for 40/40 cases in both modes, with no required-claim violations. Warm median/p95 were 339/375 ms lexical and 310/429 ms local semantic on this machine. These are developer smoke checks, not a blinded chef relevance study or evidence of increased purchasing conversion.

The broader 40-case suite (identifiers, bilingual queries, typos/use, dietary/negative constraints, pack preferences and no-match cases) passed 39/40 with lexical retrieval and 39/40 with local semantic retrieval. The remaining case is the transposed typo `mlik`; a separately exercised live Gemini call interpreted it as `milk`. These results do not establish a general relevance improvement from embeddings. A chef-labelled held-out study remains necessary.
