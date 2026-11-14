import { NextRequest, NextResponse } from "next/server";
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), "../../.env"), quiet: true });
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const routes: Record<string, string> = {
  search: "discovery/search",
  suggest: "discovery/suggest",
  compare: "discovery/compare",
  alternatives: "discovery/alternatives",
  context: "discovery/context",
  offers: "offers",
  proposals: "proposals",
  "kitchen/profiles": "kitchen/profiles",
  "kitchen/profile": "kitchen/profile",
  "kitchen/start": "kitchen/start",
  "kitchen/status": "kitchen/status",
  "kitchen/update": "kitchen/update",
  "kitchen/export": "kitchen/export",
};
async function handler(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  // Explicit local demo buyer. This proxy never borrows human/admin authority.
  if (
    process.env.NODE_ENV === "production" ||
    process.env.DEMO_MODE === "false" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(request.nextUrl.hostname)
  )
    return NextResponse.json(
      {
        message:
          "Storefront buyer sign-in must be configured outside the local demo.",
      },
      { status: 403 },
    );
  if (
    request.method === "POST" &&
    request.headers.get("origin") !== request.nextUrl.origin
  )
    return NextResponse.json(
      { message: "Cross-origin request refused." },
      { status: 403 },
    );
  const path = (await context.params).path.join("/");
  const route = routes[path];
  if (!route || (request.method === "GET") !== (path === "context"))
    return NextResponse.json(
      { message: "Unknown shopping route." },
      { status: 404 },
    );
  const body = request.method === "POST" ? await request.text() : undefined;
  if (body && body.length > (path === "kitchen/start" ? 4_500_000 : 100000))
    return NextResponse.json(
      { message: "Request is too large." },
      { status: 413 },
    );
  try {
    const upstream = await fetch(
      `${process.env.GATEWAY_URL || "http://localhost:4000"}/v1/${route}`,
      {
        method: request.method,
        headers: {
          Authorization: `Bearer ${process.env.AGENT_TOKEN || "local-buyer-demo"}`,
          "Content-Type": "application/json",
        },
        body,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { message: "Shopping service is unavailable. Please retry." },
      { status: 503 },
    );
  }
}
export const POST = handler;
export const GET = handler;
