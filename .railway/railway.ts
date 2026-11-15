import {
  defineRailway,
  github,
  preserve,
  project,
  service,
  volume,
} from "railway/iac";

export default defineRailway(() => {
  const state = volume("aimo-state", {
    region: "europe-west4",
    sizeMB: 500,
  });

  // Reuse the already-provisioned monorepo service instead of replacing it.
  const app = service("junction-repo", {
    source: github("safiulalam99/junction-repo", { branch: "main" }),
    replicas: 1,
    healthcheck: "/health",
    healthcheckTimeout: 100,
    volumeMounts: { "/data": state },
    env: {
      RAILWAY_DOCKERFILE_PATH: "infra/Dockerfile",
      PORT: "4000",
      WEB_PORT: "3100",
      STATE_DIR: "/data",
      GATEWAY_URL: "http://127.0.0.1:4000",
      PROXY_WEB: "true",
      PUBLIC_DEMO_MODE: "true",
      MOCK_VALIO: "false",
      DEMO_MODE: "false",
      ALLOW_BEARER: "true",
      VOICE_ENABLED: "false",
      VALIO_BASE_URL: "https://junction26.valioaimo.fi",
      ADMIN_TOKEN: preserve(),
      AGENT_TOKEN: preserve(),
      VALIO_API_KEY: preserve(),
      GEMINI_API_KEY: preserve(),
    },
  });

  return project("aimo-agent-gateway", { resources: [app, state] });
});
