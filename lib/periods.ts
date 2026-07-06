import "server-only";
import { sql, type Exec } from "./db";

export type FiscalPeriodRow = {
  id: string;
  period_start: string;
  period_end: string;
  fiscal_year: number;
  label: string;
  status: "open" | "closed";
  closed_by_email: string | null;
  closed_at: string | null;
  entry_count: number;
};

export type FiscalYearCloseRow = {
  fiscal_year: number;
  closed_at: string;
  closed_by_email: string | null;
  entries_created: number;
  net_income_ngn: string | null;
};

/** All periods (newest first) with the number of posted entries they cover. */
export async function getFiscalPeriods(): Promise<FiscalPeriodRow[]> {
  return sql<FiscalPeriodRow[]>`
    select fp.id, fp.period_start::text, fp.period_end::text, fp.fiscal_year,
           fp.label, fp.status, u.email as closed_by_email, fp.closed_at::text,
           coalesce(je.n, 0)::int as entry_count
    from public.fiscal_periods fp
    left join public.app_users u on u.id = fp.closed_by
    left join lateral (
      select count(*) as n from public.journal_entries j
      where j.status in ('posted','reversed')
        and j.transaction_date between fp.period_start and fp.period_end
    ) je on true
    order by fp.period_start desc`;
}

export async function getFiscalYearCloses(): Promise<FiscalYearCloseRow[]> {
  return sql<FiscalYearCloseRow[]>`
    select fyc.fiscal_year, fyc.closed_at::text, u.email as closed_by_email,
           fyc.entries_created, fyc.net_income_ngn::text
    from public.fiscal_year_closes fyc
    left join public.app_users u on u.id = fyc.closed_by
    order by fyc.fiscal_year desc`;
}

export async function closePeriod(periodStart: string, actor: string, exec: Exec = sql) {
  await exec`select public.close_fiscal_period(${periodStart}::date, ${actor})`;
}

export async function reopenPeriod(periodStart: string, actor: string, exec: Exec = sql) {
  await exec`select public.reopen_fiscal_period(${periodStart}::date, ${actor})`;
}

export async function closePeriodsThrough(through: string, actor: string, exec: Exec = sql) {
  const [row] = await exec<{ close_fiscal_periods_through: number }[]>`
    select public.close_fiscal_periods_through(${through}::date, ${actor})`;
  return row.close_fiscal_periods_through;
}

export async function closeFiscalYear(year: number, actor: string, exec: Exec = sql) {
  const [row] = await exec<{ close_fiscal_year: unknown }[]>`
    select public.close_fiscal_year(${year}, ${actor})`;
  return row.close_fiscal_year;
}
