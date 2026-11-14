import { BookOpen, Fingerprint } from "lucide-react";
export function DiscoveryContent() {
  return (
    <div className="discovery-content">
      <div className="endpoint-row">
        <span>Discovery</span>
        <code>/.well-known/aimo-agent.json</code>
        <BookOpen size={18} />
      </div>
      <div className="endpoint-row">
        <span>MCP transport</span>
        <code>/mcp</code>
        <span>Streamable HTTP</span>
      </div>
      <div className="endpoint-row">
        <span>REST interface</span>
        <code>/v1</code>
        <span>OpenAPI 3.1</span>
      </div>
      <div className="endpoint-row">
        <span>Offer verification</span>
        <code>/.well-known/jwks.json</code>
        <span>Ed25519 / JWS</span>
      </div>
      <h2>Five tools. One purchasing flow.</h2>
      <ol className="tools-list">
        {[
          ["search_catalog", "Find products in the supplied assortment."],
          ["get_offers", "Receive signed, customer-scoped fixed prices."],
          ["submit_proposal", "Check the mandate and submit a purchase."],
          ["get_proposal", "Follow a decision without bypassing it."],
          ["get_order", "Read the order and its traceable evidence."],
        ].map(([tool, description], i) => (
          <li key={tool}>
            <span className="mono">0{i + 1}</span>
            <code>{tool}</code>
            <p>{description}</p>
          </li>
        ))}
      </ol>
      <div className="note-panel">
        <Fingerprint size={22} />
        <p>
          Agents authenticate using signed Ed25519 requests. Bearer credentials
          are available when enabled. Human approval uses a separate registered
          identity.
        </p>
      </div>
    </div>
  );
}
