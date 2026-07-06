import "server-only";
import { sql } from "./db";

/**
 * Mono bank-feed sync. For every active connection with provider 'mono' and
 * an external account id, pull recent transactions and ingest them through
 * public.ingest_bank_feed_transaction (idempotent per external id), then run
 * the auto-matcher. Without MONO_SECRET_KEY everything is skipped gracefully —
 * manual feeds and the existing reconciliation flow keep working.
 */
export async function syncMonoBankFeeds(): Promise<{
  connections: number;
  ingested: number;
  matched: number;
  skipped: boolean;
  errors: string[];
}> {
  const key = process.env.MONO_SECRET_KEY;
  if (!key) return { connections: 0, ingested: 0, matched: 0, skipped: true, errors: [] };

  const connections = await sql<{ id: string; bank_account_id: string; external_account_id: string }[]>`
    select id, bank_account_id, external_account_id
    from public.bank_feed_connections
    where is_active and provider = 'mono' and external_account_id is not null`;

  let ingested = 0;
  const errors: string[] = [];

  for (const conn of connections) {
    try {
      const res = await fetch(
        `https://api.withmono.com/v2/accounts/${conn.external_account_id}/transactions?paginate=false`,
        { headers: { "mono-sec-key": key }, signal: AbortSignal.timeout(30_000) }
      );
      if (!res.ok) { errors.push(`${conn.external_account_id}: HTTP ${res.status}`); continue; }
      const payload = (await res.json()) as {
        data?: Array<{ id: string; amount: number; date: string; narration?: string; type?: string; currency?: string }>;
      };
      for (const t of payload.data ?? []) {
        // Mono amounts are in kobo; credits inflow, debits outflow (signed).
        const amount = (t.type === "debit" ? -1 : 1) * Math.abs(t.amount) / 100;
        const [row] = await sql<{ ingest_bank_feed_transaction: string | null }[]>`
          select public.ingest_bank_feed_transaction(
            ${conn.bank_account_id}, 'mono'::public.bank_feed_provider, ${t.id},
            ${t.date?.slice(0, 10)}::date, ${amount}, ${(t.currency ?? "NGN").toUpperCase()},
            ${t.narration ?? null}, ${sql.json(t as never)})`;
        if (row.ingest_bank_feed_transaction) ingested++;
      }
      await sql`update public.bank_feed_connections set last_synced_at = now() where id = ${conn.id}`;
    } catch (e) {
      errors.push(`${conn.external_account_id}: ${(e as Error).message}`);
    }
  }

  const [m] = await sql<{ auto_match_bank_feed: number }[]>`select public.auto_match_bank_feed()`;
  return { connections: connections.length, ingested, matched: m.auto_match_bank_feed, skipped: false, errors };
}
