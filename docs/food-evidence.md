# When a supplier changes its egg declaration

A kitchen manager has a €120 pasta order waiting for approval. The buyer's spending limit is €100. The manager can authorise the extra €20. What happens if the supplier withdraws its egg declaration while the order is waiting?

## The law and the buying decision

The example concerns prepacked pasta supplied to a catering kitchen for preparation. Under Article 8(7)(b) of Regulation (EU) No 1169/2011, the food business operator must provide the mandatory particulars on the pack, on an attached label or in commercial documents that identify the food. The operator can use documents if it can guarantee that they accompany the goods or have been sent before or at the time of delivery. Article 8(7) also requires four specified particulars to appear on the outer packaging. Article 9(1)(c) covers ingredients and processing aids derived from or listed in Annex II that were used in production and remain in the finished food. Eggs and egg products appear in Annex II, point 3. [Regulation (EU) No 1169/2011, Articles 8 and 9 and Annex II](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX%3A02011R1169-20250401)

The kitchen adds its own purchasing condition. When `requireEggDeclaration` is enabled on a buyer's mandate, every product in the basket needs a current supplier statement that explicitly declares it free from egg. The requirement to hold that evidence **before purchase** comes from the kitchen. The regulation cited above governs food information. A supplier statement records what the supplier says about the product. Checking its accuracy and managing cross-contact in the kitchen are separate tasks.

## What happens to the order

These two fictional records concern the same product, `DEMO-PASTA-001`, in section 3 of the same supplier document, `DEMO-MILL-PASTA`. The demo compares two identical €120 baskets. The manager approves the first while revision 1 is current. Revision 2 arrives while the second basket is awaiting a decision.

| Supplier record | Gateway decision |
| --- | --- |
| [Revision 1](../data/fixtures/food-evidence/declared.json) explicitly declares the pasta free from egg. | The product passes the kitchen rule. Four packs (€40 in total) can proceed under the demo mandate. Twelve packs (€120 in total) need a manager's spending decision. |
| [Revision 2](../data/fixtures/food-evidence/withdrawn.json) withdraws the statement. The egg status is now unspecified. | The manager can no longer approve the second €120 basket. The gateway refuses the purchase because the egg status is unknown, records both versions and creates no order for that request. |

A missing statement, or one that leaves egg unspecified, produces an **unknown** result. A supplier warning that the food contains or may contain egg, or an egg flag in the quoted or current catalogue entry, produces a **contradicted** result. Both outcomes stop an opted-in purchase. A manager may authorise a budget exception only while the food evidence still supports the purchase. Even a new revision that continues to support the claim needs a fresh review for a pending approval.

## Replay the case

Use Node 22 and pnpm 11.25.0. From the repository root, run the following commands.

```sh
pnpm install --frozen-lockfile
pnpm demo:food-evidence
pnpm exec vitest run tests/food-evidence.test.ts
```

The demo uses an in-memory database, a fictional supplier and simulated orders. It prints both versions of the declaration, the totals and the audit event. The tests also read the same decision through the web API and the gateway's Model Context Protocol (MCP) interface for AI agents. [Rule implementation](../packages/rules/src/egg-evidence.ts) · [Regression tests](../tests/food-evidence.test.ts)

In the manager workspace, the buyer’s mandate editor has a **Supplier egg declaration** setting. For a persistent local run, a trusted operator can load a structured supplier record with `pnpm evidence:import <supplier-declaration.json>`. A changed record needs a higher revision. Stop the gateway first if it uses the same embedded database directory. The supplier records and prices are fictional. A live supplier feed and verification of supplier statements are outside the scope of this demo.

The purchasing gateway, signed offers and manager workflow were built by team fatbois at Junction. This fork adds the source-linked kitchen rule, supplier records, recheck at approval and regression tests as an AI-assisted portfolio contribution by `@hyvaapoika`. [Original team implementation](https://github.com/safiulalam99/junction-repo/tree/c09f98678980bf7004bd9c2e2f89ef5f6a5402f9)
