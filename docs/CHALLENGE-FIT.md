# Fit to Trusted Trade Agents by Valio Aimo

The supplied challenge brief is the acceptance reference. The earlier implementation plan is our proposed design, not a list of features required by the organizers. See the [credential-redacted brief](CHALLENGE-BRIEF.md).

The challenge asks for an interface through which an external purchasing agent can obtain structured product, price, and availability information, turn an inquiry into a fixed-price commitment, and act within human-controlled permissions. Both the supplied data and the hosted Valio APIs are synthetic. It does not require building a marketplace, payments, voice, or a particular agent protocol.

| Judging criterion | Implemented evidence | Remaining demo gap |
| --- | --- | --- |
| Working end-to-end demo — 30% | Local request → signed offer → proposal → AUTO/HOLD/REFUSE → human approval → simulated order; independent signed buyer and MCP client | Rehearse the complete flow using hosted Valio responses. Hosted lookup alone is verified. |
| Matching the user need — 20% | Product claims, units, pack conversion, delivery date, feasible substitutes, and structured inventory requirements | Make the exact buyer requirement central to the presentation. The web demo is predefined; arbitrary natural-language request entry is not implemented. |
| Autonomy and controls — 20% | Mandates, spending limits, deterministic decisions, separate human approval, signed offers, replay protection, and auditable transitions | Explain the local human identity assumption and how production identity would replace it. |
| Exceptions — 15% | Blocked products, insufficient stock, unknown availability, delivery constraints, substitutions, amendment and reapproval | Show one exception from initial request to resolution in the presentation. |
| Openness and production path — 15% | REST/OpenAPI, JSON Schema, MCP, Ed25519 JWS, documented HTTP signature profile, PostgreSQL, and demo UBL XML | External security review, production identity, fulfillment integration, and standards conformance remain future work. |

## Recommended presentation flow

1. State the buyer's exact request and constraints. The organizer's example is 1,000 litres of lactose-free milk by Monday; use an explicit date when rehearsing.
2. Show the agent finding products and checking claims, unit conversion, price, and availability.
3. Show the fixed-price offer and which mandate rules permit autonomy or require approval.
4. Let the human approve a policy exception, then show the resulting simulated order and audit evidence.
5. Demonstrate an infeasible quantity or unavailable item, resolve it, and show that approval cannot override physical feasibility.
6. Close with the external agent interface and the documented production boundaries.

Prioritize this flow before adding optional voice, SMS, payments, or additional model providers. Claude can demonstrate an external reasoning agent; Gemini review is optional and advisory. ElevenLabs is not needed for the core challenge.

## Hosted lookup verification — 14 November 2026

The supplied Valio API key is configured in the ignored local `.env`; it is excluded from this document and Git. `/api/ping`, `/api/price`, and `/api/availability` succeeded. The actual `LiveValioClient` also successfully parsed price and availability for product 464201, customer hotel-haven, requested date 2026-11-16. The returned catalog price was EUR 1.56 per stated price quantity; this is synthetic challenge data, not a commercial quotation.

The running application remains in local fixture mode. No real order or payment was submitted, and no complete hosted purchasing run is claimed.
