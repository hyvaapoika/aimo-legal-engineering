import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
const upstream = new Client({ name: "aimo-desktop-bridge", version: "0.1.0" });
await upstream.connect(
  new StreamableHTTPClientTransport(
    new URL(`${process.env.PUBLIC_GATEWAY_URL || "http://localhost:4000"}/mcp`),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${process.env.AGENT_TOKEN || "local-buyer-demo"}`,
        },
      },
    },
  ),
);
const server = new Server(
  { name: "aimo-agent-gateway", version: "0.1.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, () => upstream.listTools());
server.setRequestHandler(CallToolRequestSchema, (request) =>
  upstream.callTool(request.params),
);
await server.connect(new StdioServerTransport());
process.on("SIGINT", () => {
  void Promise.all([server.close(), upstream.close()]).then(() =>
    process.exit(0),
  );
});
