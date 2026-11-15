import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { publicDemoLoginEnabled, requestOriginMatches } from "../demo-mode";
import { publicDemoRateLimit } from "../public-demo-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const adminToken = () =>
  process.env.ADMIN_TOKEN ||
  (process.env.NODE_ENV !== "production" ? "local-admin-demo" : "");
const equal = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
function signature(payload: string) {
  return createHmac("sha256", adminToken()).update(payload).digest("base64url");
}
function validSession(value: string) {
  const [payload, mac] = value.split(".");
  if (!payload || !mac || !equal(mac, signature(payload))) return false;
  const issued = Number(payload.split("-")[0]);
  return (
    Number.isFinite(issued) &&
    issued <= Date.now() &&
    Date.now() - issued < 8 * 3_600_000
  );
}
async function handler(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const route = path.join("/");
  if (!adminToken())
    return NextResponse.json(
      { message: "Set ADMIN_TOKEN on the web server." },
      { status: 503 },
    );
  const rateBucket =
    route === "session" ? "admin:session" : `admin:${request.method}:${route}`;
  const limit = publicDemoRateLimit(
    request,
    rateBucket,
    route === "session" ? 6 : route === "snapshot" ? 120 : 30,
  );
  if (!limit.allowed)
    return NextResponse.json(
      { message: "The shared demo is busy. Please retry shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (!requestOriginMatches(origin, request.nextUrl.origin))
      return NextResponse.json(
        { message: "Cross-origin request refused." },
        { status: 403 },
      );
  }
  if (route === "session" && request.method === "POST") {
    const input = await request.json().catch(() => ({}));
    if (
      typeof input.token !== "string" ||
      input.token.length > 1000 ||
      (!publicDemoLoginEnabled(input.token) &&
        !equal(
          createHmac("sha256", "compare").update(input.token).digest("hex"),
          createHmac("sha256", "compare").update(adminToken()).digest("hex"),
        ))
    )
      return NextResponse.json(
        { message: "Incorrect access token." },
        { status: 401 },
      );
    const payload = `${Date.now()}-${randomBytes(24).toString("hex")}`;
    const response = NextResponse.json({ ok: true });
    response.cookies.set("aimo_session", `${payload}.${signature(payload)}`, {
      httpOnly: true,
      sameSite: "strict",
      secure: request.nextUrl.protocol === "https:",
      maxAge: 8 * 3600,
      path: "/",
    });
    return response;
  }
  if (route === "session" && request.method === "DELETE") {
    const response = NextResponse.json({ ok: true });
    response.cookies.delete("aimo_session");
    return response;
  }
  if (!validSession(request.cookies.get("aimo_session")?.value || ""))
    return NextResponse.json(
      { message: "Sign in to the purchasing workspace." },
      { status: 401 },
    );
  const allowed =
    /^(snapshot|ledger\/verify|catalog\/search|catalog\/[A-Za-z0-9-]+|agents|agents\/[A-Za-z0-9-]+|approvals\/[A-Za-z0-9-]+\/decide|orders\/[A-Za-z0-9-]+\/peppol|demo|demo\/purchase|voice\/(start|prepare|utterance|end))$/;
  if (!allowed.test(route))
    return NextResponse.json({ message: "Unknown route." }, { status: 404 });
  try {
    const upstream = await fetch(
      `${process.env.GATEWAY_URL || `http://127.0.0.1:${process.env.PORT || 4000}`}/admin/${route}${request.nextUrl.search}`,
      {
        method: request.method,
        headers: {
          Authorization: `Bearer ${adminToken()}`,
          "Content-Type": "application/json",
        },
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : await request.text(),
        signal: AbortSignal.timeout(30000),
        cache: "no-store",
        redirect: "error",
      },
    );
    const headers = new Headers({
      "Content-Type":
        upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    });
    if (upstream.headers.has("content-disposition"))
      headers.set(
        "Content-Disposition",
        upstream.headers.get("content-disposition")!,
      );
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers,
    });
  } catch {
    return NextResponse.json(
      { message: "Gateway unavailable. Start the gateway and try again." },
      { status: 502 },
    );
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
