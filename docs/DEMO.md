# Presentation walkthrough

1. Run `pnpm dev`, open `http://localhost:3100`, and enter the local demo workspace.
2. Open **Agents & mandates**. Show the €2,000 order limit, €10,000 rolling-week limit, permitted categories, delivery site, and substitution policy. Expand the machine-readable mandate. The agent key is separate from the human login.
3. Open **Product catalog**. Search `lactose-free milk`. Point out product `464201`, sales unit ST, a ten-piece KI pack, positive lactose-free claim, and historical comparison signals.
4. Return to **Overview** and click **Run purchase demo** once. Explain that the prices/availability are labelled local fixtures over the supplied synthetic challenge catalog.
5. Show the €190 automatic order and the €4,042 four-line request held for policy review. The yoghurt and fish are substitutes; the blocked/short originals were not silently ordered.
6. Approve the replenishment request. The card disappears from the pending inbox, order count increases, and spend updates without a page reload.
7. Open **Orders**, select the €4,042 order, and show exact units, totals, delivery date, offer references, the human decision, and the order-placement event. Download XML or JSON if useful.
8. Return to the fish availability exception. Its Approve button is disabled. Change 150 KG to 100 KG and submit. The replacement proposal is re-evaluated; a remaining policy hold still requires a separate decision.
9. Open the dark **Activity ledger**. Show the blocked-yoghurt refusal, the human approval, and **Verify chain**. Export JSON.
10. Open **Developer access** or `/discovery`. Show the five tools and public verification keys. Use `pnpm buyer` to demonstrate the independently signed inventory-driven client, or connect an MCP client using the documented configuration.

Offline terminal proof: `pnpm demo` creates a fresh temporary database, asserts AUTO/HOLD/REFUSE, approves the feasible held proposal, prints order IDs, verifies the ledger, and closes/cleans its own temporary state. It does not alter the running browser demo database.

Be precise in the pitch: orders are simulated, app approvals are real local state transitions, and optional voice/SMS are disabled. Do not describe mock prices as live supplier responses or XML as Peppol-certified.

The [actual challenge criteria](CHALLENGE-FIT.md) favor a precise buyer request carried through the complete flow. Start the pitch with the buyer's quantity, product claims, destination, and delivery date; show how each constraint survives selection and approval. The built-in demo is a predefined replenishment scenario. Do not present it as arbitrary natural-language request parsing. Valio's hosted backend is also synthetic; its single-product lookup has been verified, while a full purchasing rehearsal using hosted responses remains outstanding.
