import "dotenv/config";
import { query } from "@anthropic-ai/claude-agent-sdk";
if (!process.env.ANTHROPIC_API_KEY)
  throw new Error(
    "Set ANTHROPIC_API_KEY to run the optional model-driven buyer. The signed deterministic buyer needs no model key.",
  );
const target = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
for await (const message of query({
  prompt: `Use only the Aimo MCP tools. Search for lactose-free milk, obtain offers for at most three products for ${target}, choose a product with a positive FREE_FROM_LACTOSE claim, and submit a proposal for 100 sales units to haven-kitchen with a fresh idempotencyKey. Prices are fixed. Explain the rule verdict and stop if held or refused. Never claim to approve a held proposal.`,
  options: {
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
    maxTurns: 10,
    maxBudgetUsd: 2,
    tools: [],
    allowedTools: [
      "mcp__aimo__search_catalog",
      "mcp__aimo__get_offers",
      "mcp__aimo__submit_proposal",
      "mcp__aimo__get_proposal",
      "mcp__aimo__get_order",
    ],
    mcpServers: {
      aimo: {
        type: "http",
        url: `${process.env.PUBLIC_GATEWAY_URL || "http://localhost:4000"}/mcp`,
        headers: {
          Authorization: `Bearer ${process.env.AGENT_TOKEN || "local-buyer-demo"}`,
        },
      },
    },
    persistSession: false,
  },
})) {
  if (message.type === "result") console.log(JSON.stringify(message, null, 2));
}
