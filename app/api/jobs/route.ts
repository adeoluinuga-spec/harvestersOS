import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { processMessageOutbox } from "@/lib/notify";
import { ingestDailyFxRates } from "@/lib/fx";
import { syncMonoBankFeeds } from "@/lib/bankFeeds";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background-job entry point. Two callers:
 *   • A platform scheduler (Vercel cron via vercel.json, or any external
 *     cron hitting this URL) — authenticated by CRON_SECRET.
 *   • pg_cron runs the pure-SQL nightly jobs directly in the database; this
 *     route is still the only place the MESSAGE OUTBOX can drain, because
 *     provider calls (Resend/Termii) live in the app tier.
 *
 * GET /api/jobs           → drain outbox + run nightly SQL jobs
 * GET /api/jobs?only=outbox → drain outbox only (safe to run every minute)
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const provided = auth?.replace(/^Bearer\s+/i, "") ?? request.nextUrl.searchParams.get("secret");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const only = request.nextUrl.searchParams.get("only");
  const result: Record<string, unknown> = {};

  result.outbox = await processMessageOutbox(200);

  if (only !== "outbox") {
    const [row] = await sql<{ run_nightly_jobs: unknown }[]>`select public.run_nightly_jobs()`;
    result.nightly = row.run_nightly_jobs;
    // App-tier integrations (need fetch): daily FX + Mono bank feeds.
    // Each degrades to a report line, never a failed job run.
    try { result.fx = await ingestDailyFxRates(); } catch (e) { result.fx = { error: (e as Error).message }; }
    try { result.bank_feeds = await syncMonoBankFeeds(); } catch (e) { result.bank_feeds = { error: (e as Error).message }; }
  }

  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), ...result });
}
