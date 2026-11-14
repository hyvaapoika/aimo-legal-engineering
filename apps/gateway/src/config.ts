import "dotenv/config";
import { resolve } from "node:path";
import { DomainError } from "@aimo/schema";
export function configuration() {
  const mock = process.env.MOCK_VALIO !== "false";
  const demo =
    mock &&
    process.env.DEMO_MODE !== "false" &&
    process.env.NODE_ENV !== "production";
  const adminToken =
    process.env.ADMIN_TOKEN || (demo ? "local-admin-demo" : "");
  const agentToken =
    process.env.AGENT_TOKEN || (demo ? "local-buyer-demo" : "");
  if (
    !adminToken ||
    !agentToken ||
    (!demo &&
      (adminToken.length < 32 ||
        agentToken.length < 32 ||
        adminToken === agentToken))
  )
    throw new DomainError(
      "CONFIGURATION",
      "Set distinct ADMIN_TOKEN and AGENT_TOKEN values of at least 32 characters outside local demo mode.",
      500,
    );
  if (process.env.VOICE_ENABLED === "true")
    throw new DomainError(
      "VOICE_NOT_CONFIGURED",
      "Voice is disabled in this build. Use the verified app approval flow; see docs/ASSUMPTIONS.md.",
      500,
    );
  return {
    mock,
    demo,
    adminToken,
    agentToken,
    allowBearer: process.env.ALLOW_BEARER !== "false",
    port: Number(process.env.PORT || 4000),
    publicUrl: process.env.PUBLIC_GATEWAY_URL || "http://localhost:4000",
    webOrigin: process.env.WEB_ORIGIN || "http://localhost:3100",
    dataDir: resolve("data"),
    stateDir: resolve(process.env.STATE_DIR || ".local"),
    databaseUrl: process.env.DATABASE_URL || undefined,
    valioBaseUrl:
      process.env.VALIO_BASE_URL || "https://junction26.valioaimo.fi",
    valioApiKey: process.env.VALIO_API_KEY || "",
  };
}
export type Configuration = ReturnType<typeof configuration>;
