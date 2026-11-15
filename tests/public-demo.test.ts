import { describe, expect, it } from "vitest";
import {
  publicDemoEnabled,
  publicDemoLoginEnabled,
  requestOriginMatches,
  storeProxyEnabled,
} from "../apps/web/app/api/demo-mode";

describe("explicit public demo access", () => {
  it("requires production and an explicit public sandbox flag", () => {
    expect(publicDemoEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(
      publicDemoEnabled({ NODE_ENV: "development", PUBLIC_DEMO_MODE: "true" }),
    ).toBe(false);
    expect(
      publicDemoEnabled({ NODE_ENV: "production", PUBLIC_DEMO_MODE: "true" }),
    ).toBe(true);
  });

  it("keeps the storefront local by default and only opens it in public demo mode", () => {
    expect(storeProxyEnabled("localhost", { NODE_ENV: "production" })).toBe(
      false,
    );
    expect(
      storeProxyEnabled("example.com", {
        NODE_ENV: "production",
        PUBLIC_DEMO_MODE: "true",
      }),
    ).toBe(true);
    expect(
      storeProxyEnabled("example.com", {
        NODE_ENV: "development",
        PUBLIC_DEMO_MODE: "true",
      }),
    ).toBe(false);
    expect(
      storeProxyEnabled("localhost", {
        NODE_ENV: "development",
        DEMO_MODE: "false",
      }),
    ).toBe(false);
  });

  it("accepts only the explicit public demo login phrase in that mode", () => {
    const env = { NODE_ENV: "production", PUBLIC_DEMO_MODE: "true" };
    expect(publicDemoLoginEnabled("public-demo", env)).toBe(true);
    expect(publicDemoLoginEnabled("local-admin-demo", env)).toBe(false);
    expect(
      publicDemoLoginEnabled("public-demo", { NODE_ENV: "production" }),
    ).toBe(false);
  });

  it("checks public POST origins against the configured Railway domain", () => {
    const env = {
      NODE_ENV: "production",
      PUBLIC_DEMO_MODE: "true",
      RAILWAY_PUBLIC_DOMAIN: "aimo-example.up.railway.app",
    };
    expect(
      requestOriginMatches(
        "https://aimo-example.up.railway.app",
        "http://127.0.0.1:3100",
        env,
      ),
    ).toBe(true);
    expect(
      requestOriginMatches(
        "https://attacker.example",
        "http://127.0.0.1:3100",
        env,
      ),
    ).toBe(false);
  });
});
