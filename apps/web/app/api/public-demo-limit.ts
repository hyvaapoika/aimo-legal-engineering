import { publicDemoEnabled } from "./demo-mode";

type WindowCounter = { count: number; resetsAt: number };
const windows = new Map<string, WindowCounter>();
const WINDOW_MS = 60_000;

const clientIp = (request: Request) =>
  request.headers.get("x-real-ip")?.trim() || "unknown";

export function publicDemoRateLimit(
  request: Request,
  bucket: string,
  perMinute: number,
  now = Date.now(),
) {
  if (!publicDemoEnabled()) return { allowed: true, retryAfter: 0 };

  const ip = clientIp(request);
  const keys = [`${bucket}:${ip}`, `${bucket}:global`];
  const capacities = [perMinute, perMinute * 12];
  let retryAfter = 0;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    let window = windows.get(key);
    if (!window || now >= window.resetsAt) {
      window = { count: 0, resetsAt: now + WINDOW_MS };
      windows.set(key, window);
    }
    if (window.count >= capacities[i]!)
      retryAfter = Math.max(
        retryAfter,
        Math.ceil((window.resetsAt - now) / 1000),
      );
  }

  if (retryAfter) return { allowed: false, retryAfter };
  for (const key of keys) windows.get(key)!.count++;

  if (windows.size > 20_000)
    for (const [key, window] of windows)
      if (now >= window.resetsAt) windows.delete(key);

  return { allowed: true, retryAfter: 0 };
}
