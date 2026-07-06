import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Best-effort rate limiting for the abuse-prone endpoints (login attempts and
 * the global search API). In-memory per server instance — a determined
 * distributed attacker needs an edge/WAF layer, but this stops the cheap
 * stuff: credential stuffing from one IP and search-endpoint hammering.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const LIMITS: Array<{ match: (req: NextRequest) => boolean; key: string; max: number; windowMs: number }> = [
  { match: (r) => r.nextUrl.pathname.startsWith("/api/search"), key: "search", max: 60, windowMs: 60_000 },
  { match: (r) => r.nextUrl.pathname.startsWith("/login") && r.method === "POST", key: "login", max: 10, windowMs: 60_000 },
  { match: (r) => r.nextUrl.pathname.startsWith("/auth") && r.method === "POST", key: "auth", max: 10, windowMs: 60_000 },
];

function rateLimit(request: NextRequest): NextResponse | null {
  const rule = LIMITS.find((l) => l.match(request));
  if (!rule) return null;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  const key = `${rule.key}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    if (buckets.size > 10_000) {
      buckets.forEach((v, k) => {
        if (v.resetAt < now) buckets.delete(k);
      });
    }
    return null;
  }
  b.count += 1;
  if (b.count > rule.max) {
    return new NextResponse("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((b.resetAt - now) / 1000)) },
    });
  }
  return null;
}

export async function middleware(request: NextRequest) {
  const limited = rateLimit(request);
  if (limited) return limited;
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next internals and static asset files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
