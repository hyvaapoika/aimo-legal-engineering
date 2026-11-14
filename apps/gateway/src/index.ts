import { serve } from "@hono/node-server";
import { configuration } from "./config.js";
import { bootstrap } from "./service.js";
import { createApp } from "./http.js";
import { processApprovalQueue } from "./worker.js";
const config = configuration();
const service = await bootstrap(config);
const app = createApp(service, config);
const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.demo ? "127.0.0.1" : "0.0.0.0",
});
const worker = setInterval(() => {
  void processApprovalQueue(service).catch((error) =>
    console.error(
      "Approval queue:",
      error instanceof Error ? error.name : "error",
    ),
  );
}, 5000);
console.log(
  `Aimo gateway: ${config.publicUrl} · ${service.catalog.products.length} products · ${service.valio.source} mode`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(worker);
    server.close(() => {
      void service
        .closeDiscovery()
        .then(() => service.db.close())
        .then(() => process.exit(0));
    });
  });
