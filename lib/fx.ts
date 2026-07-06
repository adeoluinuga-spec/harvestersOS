import "server-only";
import { sql } from "./db";

/**
 * Daily FX ingestion. Pulls closing rates for every non-NGN functional
 * currency in use and appends them to the immutable fx_rates table (one row
 * per pair per day; re-runs are no-ops). Source: open.er-api.com (no key
 * required); switch FX_RATE_SOURCE_URL when an official CBN feed is adopted.
 * Historical postings are NEVER restated — new rates only affect new
 * transactions and period-end revaluation.
 */
export async function ingestDailyFxRates(): Promise<{
  inserted: number;
  skipped: number;
  errors: string[];
}> {
  const pairs = await sql<{ currency: string }[]>`
    select distinct functional_currency as currency
    from public.entities
    where is_active and functional_currency <> 'NGN'`;

  const today = new Date().toISOString().slice(0, 10);
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const { currency } of pairs) {
    try {
      const base = process.env.FX_RATE_SOURCE_URL || "https://open.er-api.com/v6/latest";
      const res = await fetch(`${base}/${currency}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) { errors.push(`${currency}: HTTP ${res.status}`); continue; }
      const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
      const rate = data.rates?.NGN;
      if (data.result !== "success" || !rate || rate <= 0) {
        errors.push(`${currency}: no NGN rate in response`);
        continue;
      }
      const rows = await sql`
        insert into public.fx_rates (currency_pair, rate, effective_date, source)
        select ${currency + "/NGN"}, ${rate}, ${today}::date, 'open.er-api.com'
        where not exists (
          select 1 from public.fx_rates
          where currency_pair = ${currency + "/NGN"} and effective_date = ${today}::date)
        returning id`;
      if (rows.length > 0) inserted++; else skipped++;
    } catch (e) {
      errors.push(`${currency}: ${(e as Error).message}`);
    }
  }
  return { inserted, skipped, errors };
}
