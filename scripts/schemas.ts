import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { domainSchemas } from "@aimo/schema";
import { openapi, discovery } from "../apps/gateway/src/openapi.js";
await mkdir("packages/schema/json", { recursive: true });
for (const [name, schema] of Object.entries(domainSchemas))
  await writeFile(
    `packages/schema/json/${name}.schema.json`,
    JSON.stringify(
      z.toJSONSchema(schema, { unrepresentable: "any" }),
      null,
      2,
    ) + "\n",
  );
await writeFile(
  "docs/openapi.json",
  JSON.stringify(openapi("http://localhost:4000"), null, 2) + "\n",
);
await writeFile(
  "docs/discovery.json",
  JSON.stringify(discovery("http://localhost:4000"), null, 2) + "\n",
);
console.log("Published domain schemas, OpenAPI, and discovery example.");
