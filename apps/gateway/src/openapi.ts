import { z } from "zod";
import {
  domainSchemas,
  offersInputSchema,
  proposalInputSchema,
  decisionSchema,
  mandateSchema,
} from "@aimo/schema";
const json = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { unrepresentable: "any" });
export function openapi(baseUrl: string) {
  const operation = (summary: string, body?: z.ZodType) => ({
    summary,
    security: [{ AgentBearer: [] }, { HttpSignature: [] }],
    ...(body
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: json(body) } },
          },
        }
      : {}),
    responses: {
      "200": {
        description: "Successful result",
        content: { "application/json": { schema: { type: "object" } } },
      },
      "400": { description: "Invalid request" },
      "401": { description: "Authentication required" },
      "403": { description: "Scope or identity refused" },
      "409": { description: "Conflict or revalidation required" },
      "502": { description: "Supplier unavailable" },
    },
  });
  return {
    openapi: "3.1.0",
    info: {
      title: "Aimo Agent Gateway",
      version: "0.1.0",
      description:
        "Agent-native commerce with deterministic policy and simulated order placement. Valio X-API-Key is server-side only.",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/v1/catalog/search": {
        get: {
          ...operation("Search the supplied catalog"),
          parameters: [
            { name: "query", in: "query", schema: { type: "string" } },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 100 },
            },
            { name: "category", in: "query", schema: { type: "string" } },
            {
              name: "claims",
              in: "query",
              schema: { type: "string" },
              description: "Comma-separated positive claim codes",
            },
            { name: "allergenFree", in: "query", schema: { type: "string" } },
          ],
        },
      },
      "/v1/offers": {
        post: operation("Get signed fixed-price offers", offersInputSchema),
      },
      "/v1/proposals": {
        post: operation("Submit an idempotent proposal", proposalInputSchema),
      },
      "/v1/proposals/{id}": {
        get: {
          ...operation("Get proposal"),
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
        },
      },
      "/v1/orders/{id}": {
        get: {
          ...operation("Get order"),
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
        },
      },
      "/admin/approvals/{id}/decide": {
        post: {
          ...operation("Registered human approval", decisionSchema),
          security: [{ AdminBearer: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
        },
      },
      "/admin/agents/{id}": {
        patch: {
          ...operation(
            "Update agent mandate or status",
            z.object({
              active: z.boolean().optional(),
              mandate: mandateSchema.optional(),
            }),
          ),
          security: [{ AdminBearer: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
        },
      },
    },
    components: {
      securitySchemes: {
        AgentBearer: { type: "http", scheme: "bearer" },
        AdminBearer: {
          type: "http",
          scheme: "bearer",
          description:
            "Separate human/admin credential; buyer credentials never authorize approvals.",
        },
        HttpSignature: {
          type: "apiKey",
          in: "header",
          name: "Signature",
          description:
            "RFC 9421 Ed25519 profile; Signature-Input and Content-Digest also required.",
        },
      },
      schemas: Object.fromEntries(
        Object.entries(domainSchemas).map(([key, schema]) => [
          key,
          json(schema),
        ]),
      ),
    },
  };
}
export function discovery(baseUrl: string) {
  return {
    version: "0.1.0",
    name: "Aimo Agent Gateway",
    services: {
      commerce: { capabilities: ["catalog", "offers", "proposals", "orders"] },
    },
    transports: {
      mcp: `${baseUrl}/mcp`,
      rest: `${baseUrl}/v1`,
      openapi: `${baseUrl}/openapi.json`,
    },
    signing_keys: `${baseUrl}/.well-known/jwks.json`,
    auth: {
      scheme: "http-message-signatures",
      alg: "ed25519",
      coveredComponents: ["@method", "@target-uri", "content-digest"],
      bearerFallback: "Deployment controlled; see ALLOW_BEARER",
      registration: `${baseUrl}/admin/agents`,
    },
    policies: {
      humanApproval: true,
      fixedPrices: true,
      orderPlacement: "simulated",
      missingAllergens: "unknown",
    },
    terms: "Junction 2026 demonstration. Not a production commerce endpoint.",
  };
}
