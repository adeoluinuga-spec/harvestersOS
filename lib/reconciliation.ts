import "server-only";
import { sql, type Exec } from "./db";

type Scope = "all" | string[];
const scoped = (col: string, scope: Scope) =>
  scope === "all"
    ? sql`true`
    : scope.length === 0
      ? sql`false`
      : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export async function getReconciliationDashboard(scope: Scope) {
  return sql`
    select *
    from public.bank_reconciliation_dashboard
    where ${scoped("entity_id", scope)}
    order by manual_review_queue desc, unmatched_bank_transactions desc, entity_name, bank_name`;
}

export async function getUnreconciledItems(scope: Scope) {
  return sql`
    select *
    from public.unreconciled_operational_items
    where ${scoped("entity_id", scope)}
    order by is_stale desc, age_days desc, item_date desc
    limit 100`;
}

export async function getBankAccountsForReconciliation(scope: Scope) {
  return sql`
    select ba.id, ba.entity_id, e.name as entity_name, ba.bank_name,
           ba.account_number_last4, ba.currency
    from public.bank_accounts ba
    join public.entities e on e.id = ba.entity_id
    where ba.is_active and ${scoped("ba.entity_id", scope)}
    order by e.name, ba.bank_name`;
}

export async function getUnmatchedBankTransactions(scope: Scope) {
  return sql`
    select bft.*, ba.bank_name, ba.account_number_last4, e.name as entity_name
    from public.bank_feed_transactions bft
    join public.bank_accounts ba on ba.id = bft.bank_account_id
    join public.entities e on e.id = ba.entity_id
    where bft.status = 'unmatched' and ${scoped("ba.entity_id", scope)}
    order by bft.imported_at, bft.transaction_date
    limit 100`;
}

export async function getCandidateJournalLines(scope: Scope) {
  return sql`
    select jel.id, jel.journal_entry_id, je.transaction_date, je.description,
           e.name as entity_name, a.code as account_code, a.name as account_name,
           jel.debit_amount, jel.credit_amount, jel.currency
    from public.journal_entry_lines jel
    join public.journal_entries je on je.id = jel.journal_entry_id
    join public.entities e on e.id = jel.entity_id
    join public.accounts a on a.id = jel.account_id
    left join public.reconciliation_matches rm on rm.matched_journal_entry_line_id = jel.id
    where je.status = 'posted'
      and rm.id is null
      and ${scoped("jel.entity_id", scope)}
    order by je.transaction_date desc, je.created_at desc
    limit 150`;
}

export async function ingestBankFeedTransaction(
  d: {
    bankAccountId: string;
    provider: string;
    externalTransactionId: string;
    transactionDate: string;
    amount: string;
    currency: string;
    description: string | null;
  },
  exec: Exec = sql
) {
  const [row] = await exec<{ ingest_bank_feed_transaction: string }[]>`
    select public.ingest_bank_feed_transaction(
      ${d.bankAccountId}, ${d.provider}::public.bank_feed_provider,
      ${d.externalTransactionId}, ${d.transactionDate}::date, ${d.amount},
      ${d.currency}, ${d.description}, '{}'::jsonb
    )`;
  return row.ingest_bank_feed_transaction;
}

export async function runAutoMatch(bankAccountId: string | null, exec: Exec = sql) {
  const [row] = await exec<{ auto_match_bank_feed: number }[]>`
    select public.auto_match_bank_feed(${bankAccountId})`;
  return row.auto_match_bank_feed;
}

export async function manualMatch(
  d: { bankFeedTransactionId: string; journalEntryLineId: string; actor: string },
  exec: Exec = sql
) {
  await exec`
    select public.manual_match_bank_feed(${d.bankFeedTransactionId}, ${d.journalEntryLineId}, ${d.actor})`;
}

export async function getUsersForCashCount() {
  return sql`
    select id, email
    from public.app_users
    order by email`;
}

export async function createCashCountSession(
  d: {
    entityId: string;
    serviceDate: string;
    countedBy: string[];
    totalCounted: string;
    currency: string;
    sealedBagReference: string;
    actor: string;
  },
  exec: Exec = sql
) {
  const [row] = await exec<{ id: string }[]>`
    insert into public.cash_count_sessions
      (entity_id, service_date, counted_by, total_counted, currency,
       sealed_bag_reference, created_by)
    values
      (${d.entityId}, ${d.serviceDate}::date, ${d.countedBy}::uuid[],
       ${d.totalCounted}, ${d.currency}, ${d.sealedBagReference}, ${d.actor})
    returning id`;
  return row.id;
}

export async function getCashCountSessions(scope: Scope) {
  return sql`
    select ccs.*, e.name as entity_name,
           coalesce(cd.deposited_amount, 0) as deposited_amount,
           cd.deposit_date, cd.variance, cd.variance_status
    from public.cash_count_sessions ccs
    join public.entities e on e.id = ccs.entity_id
    left join public.cash_deposits cd on cd.cash_count_session_id = ccs.id
    where ${scoped("ccs.entity_id", scope)}
    order by ccs.service_date desc, ccs.created_at desc
    limit 100`;
}

export async function createCashDeposit(
  d: {
    cashCountSessionId: string;
    depositedAmount: string;
    bankAccountId: string;
    depositDate: string;
    depositSlipReference: string;
    actor: string;
  },
  exec: Exec = sql
) {
  await exec`
    insert into public.cash_deposits
      (cash_count_session_id, deposited_amount, bank_account_id, deposit_date,
       deposit_slip_reference, created_by)
    values
      (${d.cashCountSessionId}, ${d.depositedAmount}, ${d.bankAccountId},
       ${d.depositDate}::date, ${d.depositSlipReference}, ${d.actor})`;
}

export async function getCashVarianceReport(scope: Scope) {
  return sql`
    select *
    from public.cash_variance_report
    where ${scoped("entity_id", scope)}
    order by case when variance_status = 'review_required' then 0 else 1 end,
             service_date desc`;
}
