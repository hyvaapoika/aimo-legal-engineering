import { searchInput } from "@aimo/discovery";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  DomainError,
  offersInputSchema,
  proposalInputSchema,
  searchSchema,
  type Agent,
} from "@aimo/schema";
import type { GatewayService } from "./service.js";
export async function handleMcp(
  request: Request,
  service: GatewayService,
  agent: Agent,
): Promise<Response> {
  const server = new McpServer({
    name: "aimo-agent-gateway",
    version: "0.1.0",
  });
  const call = async (
    scope: Agent["scopes"][number],
    fn: () => Promise<unknown>,
  ) => {
    try {
      if (!agent.scopes.includes(scope))
        throw new DomainError("MISSING_SCOPE", `Requires ${scope}.`, 403);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(await fn()) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              code:
                error instanceof DomainError ? error.code : "INVALID_REQUEST",
              message: error instanceof Error ? error.message : "Tool failed.",
            }),
          },
        ],
      };
    }
  };
  server.registerTool(
    "search_catalog",
    {
      description:
        "Search the static catalog. Narrow products before requesting live offers. Missing allergen declarations are unknown.",
      inputSchema: searchSchema.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => call("catalog:read", () => service.search(agent, input)),
  );
  server.registerTool(
    "discover_products",
    {
      description:
        "Search all supplier products with bilingual keyword or optional AI-assisted discovery. Returns grounded product facts, facets, and unresolved constraints; never purchases.",
      inputSchema: searchInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => call("catalog:read", () => service.discovery.search(input)),
  );
  server.registerTool(
    "compare_products",
    {
      description:
        "Compare up to three real catalogue records. Price and stock require get_offers.",
      inputSchema: { ids: z.array(z.string()).min(1).max(3) },
      annotations: { readOnlyHint: true },
    },
    ({ ids }) =>
      call("catalog:read", async () => service.discovery.compare(ids)),
  );
  server.registerTool(
    "find_alternatives",
    {
      description:
        "Return supplier-listed or same-type candidates preserving explicit dietary properties. Customer must verify suitability and obtain current offers.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ id }) =>
      call("catalog:read", async () => service.discovery.alternatives(id)),
  );
  server.registerTool(
    "get_offers",
    {
      description:
        "Get signed, customer-scoped prices and availability for a shortlist. Mock source is clearly labelled. Includes optional safe substitute candidates.",
      inputSchema: offersInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => call("offers:read", () => service.getOffers(agent, input)),
  );
  server.registerTool(
    "submit_proposal",
    {
      description:
        "Submit exact sales-unit quantities with offer IDs. AUTO creates a simulated order; HOLD requires a registered human; REFUSE cannot be overridden. Reuse idempotencyKey on retries.",
      inputSchema: proposalInputSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    (input) => call("proposals:write", () => service.submit(agent, input)),
  );
  server.registerTool(
    "get_proposal",
    {
      description: "Read this agent’s proposal status and rule explanations.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ id }) => call("orders:read", () => service.getProposal(agent, id)),
  );
  server.registerTool(
    "get_order",
    {
      description:
        "Read a simulated order, exact fixed prices, and delivery dates.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ id }) => call("orders:read", () => service.getOrder(agent, id)),
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
