import { DiscoveryContent } from "../components/discovery-content";
export default function Discovery() {
  return (
    <main className="public-discovery">
      <a className="brand" href="/">
        aimo<span>AGENT GATEWAY</span>
      </a>
      <span className="eyebrow">PUBLIC DISCOVERY</span>
      <h1>
        Open by design.
        <br />
        Accountable by default.
      </h1>
      <p>Connect a purchasing agent to a structured commerce interface.</p>
      <DiscoveryContent />
      <h2>Connect locally</h2>
      <p>
        Start the gateway, then add an HTTP MCP server using the URL below and
        the agent’s bearer credential. The gateway must have bearer access
        enabled.
      </p>
      <pre>
        {JSON.stringify(
          {
            type: "http",
            url: "http://localhost:4000/mcp",
            headers: { Authorization: "Bearer <your-agent-token>" },
          },
          null,
          2,
        )}
      </pre>
      <p>
        For a desktop client that accepts a local stdio server, use the bridge
        configuration in <code>docs/claude-desktop.json</code>. Public HTTPS
        hosting is required for remote connectors that cannot reach localhost.
      </p>
      <a className="secondary inline-button" href="/">
        Open purchasing workspace
      </a>
    </main>
  );
}
