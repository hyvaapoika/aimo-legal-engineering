type RuntimeEnvironment = Record<string, string | undefined>;

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function publicDemoEnabled(env: RuntimeEnvironment = process.env) {
  return env.NODE_ENV === "production" && env.PUBLIC_DEMO_MODE === "true";
}

export function storeProxyEnabled(
  hostname: string,
  env: RuntimeEnvironment = process.env,
) {
  const localDemo =
    env.NODE_ENV !== "production" &&
    env.DEMO_MODE !== "false" &&
    loopbackHosts.has(hostname);
  return localDemo || publicDemoEnabled(env);
}

export function publicDemoLoginEnabled(
  token: unknown,
  env: RuntimeEnvironment = process.env,
) {
  return publicDemoEnabled(env) && token === "public-demo";
}

export function requestOriginMatches(
  origin: string | null,
  fallbackOrigin: string,
  env: RuntimeEnvironment = process.env,
) {
  let expected = fallbackOrigin;
  if (publicDemoEnabled(env)) {
    try {
      expected = env.WEB_ORIGIN
        ? new URL(env.WEB_ORIGIN).origin
        : env.RAILWAY_PUBLIC_DOMAIN
          ? new URL(`https://${env.RAILWAY_PUBLIC_DOMAIN}`).origin
          : fallbackOrigin;
    } catch {
      return false;
    }
  }
  return origin === expected;
}
