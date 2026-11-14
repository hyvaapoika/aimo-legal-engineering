# Chef purchasing experience — planning draft

Date: 14 November 2026. Status: historical planning proposal. The current product direction and build sequence are in [SMART-WEBSHOP-PLAN.md](SMART-WEBSHOP-PLAN.md), which supersedes the lunch-first experience described below. Retain this document for its research and trust-boundary notes.

## Objective and scope

Help a chef at a lunch restaurant serving 50–200 portions turn an upcoming service into a suitable, understandable cart with minimal effort. This persona was selected by the user. The proposed example dish is provisional; the judges have not supplied a mandatory dish in this conversation.

The current task covers discovery, product selection, quantities, alternatives, and cart preparation. Existing downstream quotation and approval code remains available. Telephone/voice approval redesign is deferred, as requested; no integration is removed by this plan.

The newly supplied procurement requirements are source material, not implementation instructions. Their culinary examples and claims require validation; they are not authoritative substitution rules.

## Research and differentiation

Restaurant ordering is a combination of expected demand, recipes, usable stock, and supplier delivery schedules. It is not universally triggered by low inventory, nor universally just before service. Small operators may assess shelves manually; integrated operations can use recipes and sales data to estimate demand. Delivery frequency varies by customer and route.

- [National Restaurant Association: inventory and purchasing](https://restaurant.org/education-and-resources/resource-library/restaurateurs-use-tech-to-manage-inventory,-save-money/) describes manual ordering by independent operators and integration of recipes, sales, inventory, and purchasing.
- [Kespro logistics](https://www.kespro.com/logistiikka) describes customer-specific delivery days and windows. This supports asking for the required delivery before choosing products; it does not establish an Aimo delivery promise.
- [Valio Aimo: menu planning and portion scaling](https://www.valioaimo.fi/artikkelit/vinkkiartikkelit/havikki-kuriin-ruokalista-ja-raaka-ainetilaussuunnittelulla/) connects menu planning to order quantities and cautions that some culinary quantities do not scale mechanically.
- [Minun Aimo recipes and costing](https://www.valioaimo.fi/artikkelit/pinnalla-nyt/reseptisi-ja-katelaskenta-minun-aimossa/) already supports recipe import, portions, yields, contract-price product preference, costing, and adding minimum sufficient sales packs to a cart.

Therefore, recipe-to-cart alone is not a novel claim. Proposed differentiation: a visual workflow for adapting a service to changed headcount, dietary groups, product availability, and pack economics, with brief, explicit choices only where they matter. This is a hypothesis to validate with chefs and Aimo, not a claim that their current product lacks these capabilities.

Business size alone is not a sufficient segmentation rule. For now, focus on one chef's service preparation. Later, large customers may need shared approved recipes, contracted assortments, site permissions, and salesperson collaboration; retail replenishment is a separate workflow to investigate.

## Local data audit

Counts were computed from the supplied `data/products.json`, not estimated from marketing material:

| Field | Records with data | Implication |
| --- | ---: | --- |
| Total product records | 17,546 | Searchable catalogue, not a complete kitchen knowledge base |
| Media references | 13,375 | References are numeric IDs; working image URLs are not established |
| English name | 17,544 | English demo is feasible with fallback names |
| Unit-conversion entries | 14,474 | Presence does not prove every required conversion is valid |
| Ingredient text | 14,047 | Useful for detail inspection, not a complete recipe |
| Country of origin | 17,537 | Origin is not automatically a locally sourced claim |
| Nonempty allergen group | 7,205 | Absence never means allergen-free |
| Nonempty free-from group | 5,119 | Use explicit declarations for required restrictions |
| Preparation instructions | 3,480 | Many culinary-use details need other sources |

The supplied OpenAPI documents ping, price, availability, and three dataset-download routes. It does not document image retrieval, recipes, restaurant purchase history, or cart/order submission.

Before implementation, validate an authorized image retrieval route and representative images. Use honest neutral placeholders for missing or inaccessible imagery. Do not invent product packaging or guess undocumented asset URLs.

Needed additional inputs: reviewed recipes with yields and units, customer preferences, usable on-hand amounts, and real historical orders. For the hackathon, a small reviewed recipe collection and clearly identified sample customer history are acceptable. Existing synthetic prices remain labeled demo prices; live price/availability failures never silently fall back to synthetic data.

## Proposed experience

### Entry: start from the chef's task

Three routes converge on the same cart:

1. **Cook a lunch:** familiar dish/recipe cards, portion count, delivery requirement.
2. **Order again:** saved recipe or previous basket, with changes highlighted and current offers rechecked.
3. **Find ingredients:** direct visual search for a chef who already knows the products or quantities.

Do not require a recipe for direct purchasing. Do not require a chat exchange to use any route. Optional one-line typing or voice can populate visible controls later.

### Screen 1: today's service

Working example: tomato pasta for 120 lunches, of which 20 need a gluten-free variant. This is an illustrative scenario, not a validated recipe or supplier suitability claim.

Show the selected recipe, total portions, delivery date/window, portion preset, and dietary groups together. A saved recipe gives a visible, editable portion default. A broad request such as “pasta” opens a few dish choices before calculating ingredients.

Diet groups need allocation rather than independent switches: 100 standard + 20 gluten-free means 120 total. If people have overlapping restrictions, ask whether groups overlap or let the chef define a combined group. Never silently double count.

Questions appear only when their answer materially changes the basket. Saved brand, organic, and sourcing preferences remain editable in a small preferences drawer; no long mandatory onboarding questionnaire.

### Screen 2: ingredients and matched products

Show one selected product per ingredient, using a real pack photo when available, familiar name, pack size, quantity, comparable unit price, and line cost. Keep quantity controls and Swap visible. Show one short reason when useful: “Your usual product” or “Less surplus”.

The chef can enter usable on-hand amounts. If stock is unknown, do not silently assume shelves are empty or that inventory is current. Clearly indicate that on-hand stock has not been deducted, while allowing a quick full-recipe purchase draft.

Routine matches should need no click. Uncertain conversions, unavailable products, and material substitutions appear as specific decisions beside their ingredient. Show two or three meaningful alternatives initially, with access to more catalogue results.

### Screen 3: resolve a meaningful choice

A comparison displays only relevant differences: preparation form, pack amount, dietary declaration, unit price, total basket difference, surplus, and delivery eligibility. Brand or culinary notes must have a source; omit unsupported assertions about taste or cooking performance.

Do not treat coconut and almond products as universally interchangeable, or black pepper as equivalent to paprika. Match cooking role and required characteristics; an intentional recipe change is a chef decision. Omission of an essential ingredient leaves the plan incomplete until the chef changes the recipe or resolves the shortage.

Hard requirements (dietary evidence, valid units, required delivery) come before preferences (price, brand, organic, origin). A cheaper incompatible option cannot win a ranking.

### Screen 4: ready cart

Aggregate shared ingredients across recipes and variants before rounding to packs when the selected product is compatible. Preserve which dish/group each ingredient serves.

Show: planned portions, total purchase cost, any unresolved items, and meaningful leftover quantities. Allow line edits, undo, swaps, and expanding the underlying recipe math. The primary action adds the checked selection to the cart; it does not secretly place an order.

Distinguish **purchase cost per planned portion** (including bought surplus) from **recipe ingredient cost per portion** (consumed amounts). If the latter is not supported, show only the former with an accurate label.

Use compact horizontal cost bars only when helpful, behind “Cost breakdown”. Pie charts and procurement-system diagnostics are not default chef content.

## Calculation and trust boundaries

Model role: interpret intent into editable structured fields, suggest recipe/ingredient matches, and propose contextual alternatives. It cannot assert supplier facts or approve final purchasing calculations.

TypeScript role: validate dietary counts, apply reviewed recipe coefficients and yields, subtract confirmed usable stock, normalize verified units, select legal pack quantities, calculate current-offer totals, and enforce cart constraints.

For a simple ingredient, demand is the sum of reviewed recipe amounts across assigned portions, adjusted by an explicit yield when needed. Net requirement is max(0, demand minus confirmed usable stock). Choose legal sales units covering this requirement; pack rounding happens after aggregation. Mixed units without verified conversion remain unresolved.

Do not equate extra ingredient weight with extra complete meals. A defensible meal-coverage estimate requires all essential ingredients, verified yields, and the limiting ingredient, separately for each dietary variant. Prefer “0.4 kg pasta left after planned servings” to a false claim of exactly 1,007 meals. Use a chef-defined buffer, never a hidden surplus percentage.

Preserve unknown stock sentinel 999999 as unknown. Carbon and delivery reliability remain optional comparison signals with declared units/coverage, not dietary evidence or guaranteed arrival. Existing approval, transaction, credential, and ledger boundaries remain in effect after cart handoff.

## First build and demonstration sequence

1. Validate a small recipe collection, product images, required unit conversions, and a sample customer preference profile. Verify what can actually be retrieved from supplier services.
2. Design the service setup, ingredient selection, swap comparison, and cart screens with real representative catalogue records. Test a clickable prototype with the user before building the whole experience.
3. Implement deterministic recipe scaling, dietary allocation, product matching constraints, pack selection, and basket aggregation. Regression-test mixed units, overlap, unknown allergens/stock, surplus, and edits.
4. Add the visual journey and a small set of structured language shortcuts. Connect the checked cart to existing quotation logic; avoid rebuilding downstream ordering.
5. Demonstrate a saved lunch for 120 people; allocate 20 special-diet portions; adjust to 150; subtract a confirmed pantry amount; resolve one unavailable product; compare basket impact; add to cart. Use a clearly labeled fixture to make an availability edge case reproducible.

Repeat-order demo: reopen that saved lunch for a different count, refresh price/availability, and highlight changes without replaying the full setup.

Defer telephone calls, retail replenishment, full POS/ERP integration, whole-week autonomous menus, broad nutrition optimization, and a large analytics dashboard. No calls are removed during planning.

## Validation targets and unresolved questions

Proposed usability targets, not measured results: returning chef prepares a suitable cart in under one minute; new lunch in under three minutes; no required chat turns; at most two meaningful clarification moments in the main seeded scenario. Measure time, corrections, unresolved items, and whether the chef can explain the selected quantities and price changes.

Reliability targets: never silently change a dietary restriction or cooking role; never claim unknown data is verified; preserve edits across back/forward navigation; show price and pack consequences immediately; no duplicate cart lines or hidden quantity changes.

Questions for Aimo/judges: which existing Minun Aimo task still frustrates chefs; can hackathon teams access image assets, reviewed recipes, contract assortments, and purchase history; is the desired output a cart export/API handoff or an independent demo; who can provide a real chef for a short task-based usability test?

## Follow-up: contextual AI and challenge alignment

The actual [supplied challenge](CHALLENGE-BRIEF.md) requires structured external-agent product/price/availability lookup, inquiry-to-fixed-price commitment, and permission/human-approval management. End-to-end execution is 30% of judging and autonomy/controls another 20%. The chef interface is the buyer's control surface for that agent; it cannot replace the open supplier interface or the final order/approval demonstration. The supplied hosted APIs are synthetic challenge services, even when accessed over the network.

Further public process research confirms:

- [Toimitustukku](https://www.valioaimo.fi/asiakkaaksi/toimitustukku/): customer setup includes delivery-route arrangements; the webshop displays availability, sales units and prices, supports multiple baskets and edits to confirmed orders.
- [Aimo digital tools](https://www.valioaimo.fi/yritys/kumppanina-valio-aimo/innovatiiviset-tyokalut-arkesi-tueksi/): personalized product recommendations, recurring orders, baskets for different delivery days, recipe-to-cart, and A.I.mo retrieval of reports/products already exist.
- [Minun Aimo recipe workflow](https://www.valioaimo.fi/artikkelit/pinnalla-nyt/reseptisi-ja-katelaskenta-minun-aimossa/): import a recipe, adjust yield/portions, select products (contract-priced suggestions first), calculate cost, add sufficient sales packs, then edit cart/delivery date in the webshop.

This is a reconstruction from official public documentation, not an authenticated walkthrough of all current private screens. Do not claim that their current assistant cannot perform a particular action without testing it with authorized access.

### Proposed interaction contract

Use a collapsible contextual assistant on the right of the ingredient workspace on desktop; on mobile, open it from a small Ask/change control. Keep the working ingredient/cart view primary. Selecting an ingredient establishes visible context such as “Editing: tomatoes”; whole-recipe operations explicitly show their broader scope.

Route an utterance by intent:

| Intent | Response |
| --- | --- |
| Find | Update relevant product results and visible filters |
| Change a clear draft parameter | Update the draft, briefly highlight changed quantities/cost, offer Undo |
| Compare | Open product cards with price/pack/recipe consequences; leave the draft unchanged until selection |
| Explain | Give a short source-grounded answer about the selected item; do not mutate the draft |
| Ambiguous or constrained request | Ask one consequential question with clear options |

Show only the current result by default; history is optional. Never display model reasoning or streaming paragraphs as progress. Show brief real task states, e.g. checking availability, then the result. Present unrequested content only for a blocking issue or material consequence that the chef needs to know. No unsolicited recipe upsells.

For “make it cheaper”, preserve the dish, approved portion size, delivery requirement and dietary restrictions. Compare eligible product/pack options first. If savings require changing one of those constraints, explain the trade-off and ask. For “make it 150”, preserve an explicitly entered absolute dietary-group count; a percentage-based allocation scales according to its visible basis. Ask when the allocation basis is unknown.

### Agent implementation plan

One buyer agent is sufficient initially. It reads a scoped, versioned draft plus selected ingredient, recipe references, dietary allocations, customer preferences and budget. It uses documented tools to search candidates, obtain price/availability offers and propose structured draft operations. Existing deterministic code checks compatibility, calculations, authorization and current draft revision before applying any operation. All direct UI controls use the same draft operations.

The frontend renders a small set of designed result types (product results, comparison, clarification, draft change, explanation), not model-generated arbitrary HTML. A failed model call leaves the last valid draft usable. Reject stale operations rather than overwriting a newer manual edit. Draft updates are reversible and separate from supplier commitments.

The supplier gateway exposes the same structured capabilities to this buyer agent and an independent external client. Record compact evidence of requirements, tools, selected offer and human decision. In the judging demo, reveal that evidence in an optional activity view after the chef reaches the cart; then run the existing human approval and simulated order path. Removing voice later changes the approval channel, not the authorization requirement.

Success should be evaluated against a direct/manual path: fewer searches and corrections, preserved constraints, visible useful results after each request, and complete request → lookup → human approval → simulated order evidence. A small interaction concept accompanies this planning discussion; it uses illustrative local calculations and no live model or supplier calls.
