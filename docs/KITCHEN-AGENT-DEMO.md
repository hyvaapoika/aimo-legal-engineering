# Kitchen purchasing agent

Open http://localhost:3100/agent with `pnpm dev` running. This local buyer workspace prepares a basket; normal checkout and separate human approval still follow. It uses the full supplied catalogue and signed supplier offers, currently in mock mode.

## Changing lunch menu

1. Select Lunch kitchen. Open Kitchen preferences, review requirements and budget, and save. Starter preferences are examples, not learned purchase history.
2. Enter “Tomato and basil pasta for 80 people. We already have 5 kg of fresh pasta.” Include delivery in the prompt, such as “on Monday” or “delivery 2026-11-18”, and prepare.
3. Watch the actual workflow: preferences, interpretation, sourced recipe scaling, catalogue matching, offers, kitchen rules, review.
4. The sourced recipe needs 6.4 kg pasta; confirmed pantry stock reduces the purchase requirement to 1.4 kg. Pack rounding uses verified supplier contents.
5. Review the attention rows. Basil and pepper have no published quantities, and the selected cheese lacks a verified conversion. Choose explicit sales-pack quantities instead of accepting invented amounts.
6. Edit menu to change 80 to 120, or enter a follow-up request and prepare again. Verify the revised requirement before using the basket.
7. Use this basket replaces the current basket with Undo available. Request human approval through the existing basket flow.

A menu photograph or a short voice note can provide the same request. Attachments are sent to the configured Gemini service only on Prepare; raw media is not persisted in the purchase plan. Speak records up to 30 seconds and can be stopped or removed before submission. This is voice-note input, not a telephone call or continuous voice session.

## Hotel exception handling

1. Select Hotel breakfast; review and save the starter profile. It contains three explicit usual quantities, two exact SKU choices, and one approved yoghurt substitute. Edit these as needed.
2. Click Check the usual breakfast order, then Prepare my basket.
3. Mock offers make the preferred yoghurt unavailable. The approved yoghurt is selected and the reason is visible; butter and milk retain their exact SKUs.
4. Review all three lines and use the basket. Exact/approved replacement restrictions remain in the cart, including after quantity changes and merging lines.
5. Purchasing continues through existing human approval. The preparation agent cannot approve or place an order.

## Implementation and limits

- Gemini interprets text/image/audio into a strictly validated intent. TypeScript selects bounded tools and handles claims, units, quantities, availability, budgets, revisions, and basket export. The model does not write SQL, execute code, grant permission or create arbitrary products.
- `GEMINI_API_KEY` stays server-side. `DISCOVERY_MODEL` selects the model; current default is `gemini-3.5-flash-lite`. Provider schema is simplified for compatibility, then full bounded Zod validation runs locally. Without Gemini, supported text examples have an explicit local fallback; photo/audio interpretation requires Gemini.
- Only three reviewed Valio recipes are currently installed. Unsupported dishes require clarification or explicit ingredient lines. New recipe discovery, real customer order history, kitchen inventory integration and continuous background monitoring are not implemented.
- Kitchen preferences and owned plans persist in the commercial database. Revision checks reject stale edits. Profiles are customer preferences, not a replacement for server commercial mandates. Changes to a profile or mandate invalidate an existing export.
- Jobs run in the gateway process. An interrupted job becomes retryable after two minutes; this is not a durable distributed worker.
- The buyer proxy remains localhost-only and disabled in production. Production customer authentication and real supplier fulfilment need separate integration.
- Live verification used typed hotel input and synthetic image/WAV lunch fixtures with Gemini. The physical microphone capture/permission path has not been tested. Prices, stock and order outcomes in these tests were mock data. No telephone call, real order or payment was made.

## Compact workspace update

The main view now uses a short heading, smaller composer and joined ingredient rows. Workflow details and recipe sources are collapsed; the repeated onboarding and summary copy was removed. Delivery has no separate input. Typed ISO dates, Finnish day.month.year dates, English weekdays, today and tomorrow are resolved deterministically in Helsinki time before querying offers. Ambiguous/conflicting dates are rejected. If no date is included, the existing default or prior plan date is retained and shown in the review. Dates only inside an attachment are not extracted by this resolver; include delivery in the accompanying text. Browsing previous orders by calendar week is not currently an agent tool.
