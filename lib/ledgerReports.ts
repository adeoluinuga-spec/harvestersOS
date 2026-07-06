import "server-only";
import { sql } from "./db";

/**
 * Drill-down report writer: trial balance -> account ledger -> journal entry
 * -> source record & documents. Read-only, scoped, presentation currency.
 */

type Scope = "all" | string[];

export type TrialBalanceRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  debit_ngn: string;
  credit_ngn: string;
  net_ngn: string;
  line_count: number;
};

export async function getTrialBalance(
  scope: Scope,
  startDate: string,
  endDate: string,
  includeClosing = false
): Promise<TrialBalanceRow[]> {
  const ids = scope === "all" ? null : scope;
  if (ids !== null && ids.length === 0) return [];
  return sql<TrialBalanceRow[]>`
    select account_id, account_code, account_name, account_type,
           debit_ngn::text, credit_ngn::text, net_ngn::text, line_count
    from public.trial_balance(${startDate}::date, ${endDate}::date,
                              ${ids}::uuid[], ${includeClosing})`;
}

export type AccountLedgerRow = {
  journal_entry_id: string;
  entry_number: string | null;
  transaction_date: string;
  description: string | null;
  source_module: string;
  entity_name: string;
  debit_ngn: string;
  credit_ngn: string;
};

export async function getAccountLedger(
  accountId: string,
  scope: Scope,
  startDate: string,
  endDate: string,
  page: number,
  pageSize = 50
): Promise<{ rows: AccountLedgerRow[]; total: number; account: { code: string; name: string } | null }> {
  const ids = scope === "all" ? null : scope;
  if (ids !== null && ids.length === 0) return { rows: [], total: 0, account: null };
  const filter = sql`
    je.status = 'posted'
    and jel.account_id = ${accountId}
    and je.transaction_date between ${startDate}::date and ${endDate}::date
    and (${ids}::uuid[] is null or jel.entity_id = any(${ids}::uuid[]))`;

  const [rows, count, acct] = await Promise.all([
    sql<AccountLedgerRow[]>`
      select je.id as journal_entry_id, je.entry_number,
             je.transaction_date::text, je.description, je.source_module::text,
             e.name as entity_name,
             sum(round(jel.debit_amount * jel.fx_rate_to_presentation_currency, 2))::text as debit_ngn,
             sum(round(jel.credit_amount * jel.fx_rate_to_presentation_currency, 2))::text as credit_ngn
      from public.journal_entry_lines jel
      join public.journal_entries je on je.id = jel.journal_entry_id
      join public.entities e on e.id = jel.entity_id
      where ${filter}
      group by je.id, je.entry_number, je.transaction_date, je.description, je.source_module, e.name
      order by je.transaction_date desc, je.entry_number desc
      limit ${pageSize} offset ${(page - 1) * pageSize}`,
    sql<{ n: number }[]>`
      select count(distinct je.id)::int n
      from public.journal_entry_lines jel
      join public.journal_entries je on je.id = jel.journal_entry_id
      where ${filter}`,
    sql<{ code: string; name: string }[]>`
      select code, name from public.accounts where id = ${accountId}`,
  ]);
  return { rows, total: count[0]?.n ?? 0, account: acct[0] ?? null };
}

export type JournalEntryDetail = {
  id: string;
  entry_number: string | null;
  entity_id: string;
  entity_name: string;
  transaction_date: string;
  description: string | null;
  source_module: string;
  status: string;
  posted_at: string | null;
  created_by_email: string | null;
  approved_by_email: string | null;
  reversal_of_entry_id: string | null;
  reversed_by_entry_id: string | null;
  lines: Array<{
    id: string;
    account_code: string;
    account_name: string;
    entity_name: string;
    debit_amount: string;
    credit_amount: string;
    currency: string;
    fund_classification: string;
    fx_rate: string;
  }>;
  source: { kind: string; label: string; href: string } | null;
  documents: Array<{ id: string; file_name: string }>;
};

export async function getJournalEntryDetail(
  id: string,
  scope: Scope
): Promise<JournalEntryDetail | null> {
  const ids = scope === "all" ? null : scope;
  if (ids !== null && ids.length === 0) return null;

  const [je] = await sql<Array<Record<string, string | null>>>`
    select je.id, je.entry_number, je.entity_id, e.name as entity_name,
           je.transaction_date::text, je.description, je.source_module::text,
           je.status::text, je.posted_at::text, je.reversal_of_entry_id,
           cb.email as created_by_email, ab.email as approved_by_email,
           rev.id as reversed_by_entry_id
    from public.journal_entries je
    join public.entities e on e.id = je.entity_id
    left join public.app_users cb on cb.id = je.created_by
    left join public.app_users ab on ab.id = je.approved_by
    left join public.journal_entries rev on rev.reversal_of_entry_id = je.id
    where je.id = ${id}
      and (${ids}::uuid[] is null or je.entity_id = any(${ids}::uuid[]))`;
  if (!je) return null;

  const [lines, giving, disb, docs] = await Promise.all([
    sql<JournalEntryDetail["lines"]>`
      select jel.id, a.code as account_code, a.name as account_name,
             e.name as entity_name, jel.debit_amount::text, jel.credit_amount::text,
             jel.currency, jel.fund_classification::text,
             jel.fx_rate_to_presentation_currency::text as fx_rate
      from public.journal_entry_lines jel
      join public.accounts a on a.id = jel.account_id
      join public.entities e on e.id = jel.entity_id
      where jel.journal_entry_id = ${id}
      order by jel.debit_amount desc, a.code`,
    sql<{ id: string; giver: string | null }[]>`
      select gr.id, g.full_name as giver
      from public.giving_records gr
      left join public.givers g on g.id = gr.giver_id
      where gr.journal_entry_id = ${id}`,
    sql<{ id: string; requisition_request_id: string | null }[]>`
      select id, requisition_request_id
      from public.disbursement_records where journal_entry_id = ${id}`,
    sql<{ id: string; file_name: string }[]>`
      select d.id, d.file_name from public.documents d
      where not d.is_deleted
        and ((d.subject_type = 'journal_entry' and d.subject_id = ${id})
          or (d.subject_type = 'requisition' and d.subject_id in (
                select requisition_request_id from public.disbursement_records
                where journal_entry_id = ${id} and requisition_request_id is not null)))
      order by d.uploaded_at desc`,
  ]);

  let source: JournalEntryDetail["source"] = null;
  if (giving[0]) {
    source = {
      kind: "giving",
      label: `Gift${giving[0].giver ? ` from ${giving[0].giver}` : " (anonymous)"}`,
      href: "/givings",
    };
  } else if (disb[0]) {
    source = { kind: "disbursement", label: "Disbursement record", href: "/expenses/finance" };
  }

  return {
    id: String(je.id),
    entry_number: je.entry_number,
    entity_id: String(je.entity_id),
    entity_name: String(je.entity_name),
    transaction_date: String(je.transaction_date),
    description: je.description,
    source_module: String(je.source_module),
    status: String(je.status),
    posted_at: je.posted_at,
    created_by_email: je.created_by_email,
    approved_by_email: je.approved_by_email,
    reversal_of_entry_id: je.reversal_of_entry_id,
    reversed_by_entry_id: je.reversed_by_entry_id,
    lines,
    source,
    documents: docs,
  };
}
