import "server-only";
import { sql, type Exec } from "./db";

type Scope = "all" | string[];
const scoped = (col: string, scope: Scope) =>
  scope === "all"
    ? sql`true`
    : scope.length === 0
      ? sql`false`
      : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export async function getFundEntities(scope: Scope) {
  return sql`
    select id, name, type, functional_currency
    from public.entities
    where is_active and ${scoped("id", scope)}
    order by name`;
}

export async function getExpenseAccounts() {
  return sql`
    select id, code, name, fund_classification
    from public.accounts
    where account_type = 'expense' and is_active
    order by code`;
}

export async function getRestrictedFundBalances(scope: Scope) {
  return sql`
    select *
    from public.restricted_fund_balances
    where ${scoped("entity_id", scope)}
    order by entity_name, name`;
}

export async function getRestrictedFundActivity(fundId?: string) {
  const filter = fundId ? sql`restricted_fund_id = ${fundId}` : sql`true`;
  return sql`
    select *
    from public.restricted_fund_recent_activity
    where ${filter}
    order by transaction_date desc
    limit 30`;
}

export async function createRestrictedFund(
  d: {
    entityId: string;
    name: string;
    classification: string;
    targetAmount: string;
    purpose: string | null;
  },
  exec: Exec = sql
) {
  const [row] = await exec<{ id: string }[]>`
    insert into public.restricted_funds
      (entity_id, name, fund_classification, target_amount, purpose_description)
    values
      (${d.entityId}, ${d.name}, ${d.classification}::public.fund_classification,
       ${d.targetAmount}, ${d.purpose})
    returning id`;
  return row.id;
}

export async function addAllowedUse(
  fundId: string,
  accountId: string,
  exec: Exec = sql
) {
  await exec`
    insert into public.restricted_fund_allowed_uses (restricted_fund_id, account_id)
    values (${fundId}, ${accountId})
    on conflict do nothing`;
}

export async function getAllowedUses(scope: Scope) {
  return sql`
    select rf.id as restricted_fund_id, rf.name as fund_name, e.name as entity_name,
           a.id as account_id, a.code as account_code, a.name as account_name
    from public.restricted_fund_allowed_uses au
    join public.restricted_funds rf on rf.id = au.restricted_fund_id
    join public.entities e on e.id = rf.entity_id
    join public.accounts a on a.id = au.account_id
    where ${scoped("rf.entity_id", scope)}
    order by e.name, rf.name, a.code`;
}

export async function createInterFundLoan(
  d: {
    lendingEntityId: string;
    lendingFund: string | null;
    borrowingEntityId: string;
    borrowingPurpose: string;
    principalAmount: string;
    currency: string;
    dateIssued: string;
    repaymentSchedule: string;
    actor: string;
  },
  exec: Exec = sql
) {
  const [row] = await exec<{ id: string }[]>`
    insert into public.inter_fund_loans
      (lending_entity_id, lending_fund, borrowing_entity_id, borrowing_purpose,
       principal_amount, currency, date_issued, repayment_schedule, created_by)
    values
      (${d.lendingEntityId}, ${d.lendingFund}, ${d.borrowingEntityId}, ${d.borrowingPurpose},
       ${d.principalAmount}, ${d.currency}, ${d.dateIssued}::date,
       ${d.repaymentSchedule}::jsonb, ${d.actor})
    returning id`;
  return row.id;
}

export async function getInterFundLoans(scope: Scope) {
  return sql`
    select l.id, le.name as lending_entity_name, be.name as borrowing_entity_name,
           rf.name as lending_fund_name, l.borrowing_purpose, l.principal_amount,
           l.currency, l.date_issued, l.status
    from public.inter_fund_loans l
    join public.entities le on le.id = l.lending_entity_id
    join public.entities be on be.id = l.borrowing_entity_id
    left join public.restricted_funds rf on rf.id = l.lending_fund
    where ${scope === "all" ? sql`true` : scope.length === 0 ? sql`false` : sql`(l.lending_entity_id in ${sql(scope)} or l.borrowing_entity_id in ${sql(scope)})`}
    order by l.date_issued desc`;
}

export async function createInvestment(
  d: {
    entityId: string;
    investmentType: string;
    institution: string;
    principalAmount: string;
    currency: string;
    interestRate: string;
    startDate: string;
    maturityDate: string;
    actor: string;
  },
  exec: Exec = sql
) {
  const [row] = await exec<{ id: string }[]>`
    insert into public.investments
      (entity_id, investment_type, institution, principal_amount, currency,
       interest_rate, start_date, maturity_date, created_by)
    values
      (${d.entityId}, ${d.investmentType}::public.investment_type, ${d.institution},
       ${d.principalAmount}, ${d.currency}, ${d.interestRate},
       ${d.startDate}::date, ${d.maturityDate}::date, ${d.actor})
    returning id`;
  return row.id;
}

export async function updateInvestmentStatus(
  id: string,
  status: string,
  actualReturn: string,
  exec: Exec = sql
) {
  await exec`
    update public.investments
       set status = ${status}::public.investment_status,
           actual_return_amount = ${actualReturn}
     where id = ${id}`;
}

export async function refreshMaturityAlerts(exec: Exec = sql) {
  await exec`select public.refresh_investment_maturity_alerts(30)`;
}

export async function getInvestments(scope: Scope) {
  return sql`
    select *
    from public.investment_yield_tracking
    where ${scoped("entity_id", scope)}
    order by status, maturity_date`;
}

export async function getInvestmentAlerts(scope: Scope) {
  return sql`
    select a.id, a.investment_id, a.alert_date, a.days_to_maturity, a.status,
           i.institution, i.principal_amount, i.currency, i.maturity_date,
           e.name as entity_name
    from public.investment_maturity_alerts a
    join public.investments i on i.id = a.investment_id
    join public.entities e on e.id = i.entity_id
    where a.status = 'open' and ${scoped("i.entity_id", scope)}
    order by a.days_to_maturity`;
}
