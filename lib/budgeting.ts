import "server-only";
import { sql, type Exec } from "./db";

type Scope = "all" | string[];
const scoped = (col: string, scope: Scope) =>
  scope === "all"
    ? sql`true`
    : scope.length === 0
      ? sql`false`
      : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export async function getBudgetEntities(scope: Scope) {
  return sql`
    select id, parent_entity_id, name, type, functional_currency
    from public.entities
    where is_active and ${scoped("id", scope)}
    order by
      case type when 'group' then 0 when 'sub_group' then 1 when 'campus' then 2
                when 'ministry_expression' then 3 when 'event' then 4 else 5 end,
      name`;
}

export async function getBudgetAccounts() {
  return sql`
    select id, code, name, account_type, fund_classification
    from public.accounts
    where account_type in ('expense','asset') and is_active
    order by code`;
}

export async function getBudgetCycles() {
  return sql`
    select id, fiscal_year, status, created_at
    from public.budget_cycles
    order by fiscal_year desc`;
}

export async function createBudgetCycle(year: string, exec: Exec = sql) {
  const [row] = await exec<{ create_budget_cycle_from_prior: string }[]>`
    select public.create_budget_cycle_from_prior(${year})`;
  return row.create_budget_cycle_from_prior;
}

export async function updateBudgetCycleStatus(
  id: string,
  status: string,
  exec: Exec = sql
) {
  await exec`
    update public.budget_cycles
       set status = ${status}::public.budget_cycle_status
     where id = ${id}`;
}

export async function setEntityBudgetMode(
  entityId: string,
  mode: string,
  exec: Exec = sql
) {
  await exec`
    insert into public.entity_budget_settings (entity_id, enforcement_mode, updated_at)
    values (${entityId}, ${mode}::public.budget_enforcement_mode, now())
    on conflict (entity_id) do update
      set enforcement_mode = excluded.enforcement_mode, updated_at = now()`;
}

export async function submitBudgetLine(
  d: {
    cycleId: string;
    entityId: string;
    accountId: string;
    proposedAmount: string;
    submittedBy: string;
    notes: string | null;
    priorLineId: string | null;
  },
  exec: Exec = sql
) {
  const [row] = await exec<{ id: string }[]>`
    insert into public.budget_lines
      (budget_cycle_id, prior_budget_line_id, entity_id, account_id,
       proposed_amount, submitted_by, notes)
    values
      (${d.cycleId}, ${d.priorLineId}, ${d.entityId}, ${d.accountId},
       ${d.proposedAmount}, ${d.submittedBy}, ${d.notes})
    on conflict (budget_cycle_id, entity_id, account_id) do update
      set proposed_amount = excluded.proposed_amount,
          submitted_by = excluded.submitted_by,
          notes = excluded.notes,
          submitted_at = now()
    returning id`;
  return row.id;
}

export async function reviewBudgetLine(
  id: string,
  amount: string,
  justification: string,
  actor: string,
  exec: Exec = sql
) {
  await exec`
    select public.set_budget_line_review(${id}, ${amount}, ${justification}, ${actor})`;
}

export async function getBudgetLines(scope: Scope, cycleId?: string) {
  const cycleFilter = cycleId ? sql`bl.budget_cycle_id = ${cycleId}` : sql`true`;
  return sql`
    select bl.id, bl.budget_cycle_id, bc.fiscal_year, bc.status as cycle_status,
           bl.entity_id, e.name as entity_name, e.type as entity_type,
           bl.account_id, a.code as account_code, a.name as account_name,
           a.fund_classification, bl.proposed_amount, bl.approved_amount,
           public.budget_line_actuals(bl.id) as actual_amount,
           bl.notes, bl.review_justification, bl.prior_budget_line_id,
           prior.proposed_amount as prior_proposed_amount,
           prior.approved_amount as prior_approved_amount
    from public.budget_lines bl
    join public.budget_cycles bc on bc.id = bl.budget_cycle_id
    join public.entities e on e.id = bl.entity_id
    join public.accounts a on a.id = bl.account_id
    left join public.budget_lines prior on prior.id = bl.prior_budget_line_id
    where ${scoped("bl.entity_id", scope)}
      and ${cycleFilter}
    order by bc.fiscal_year desc, e.name, a.code`;
}

export async function getBudgetRollup(
  scope: Scope,
  cycleId?: string,
  fund?: string
) {
  const cycleFilter = cycleId ? sql`r.budget_cycle_id = ${cycleId}` : sql`true`;
  const fundFilter = fund ? sql`r.fund_classification::text = ${fund}` : sql`true`;
  return sql`
    select r.*
    from public.budget_vs_actual_rollup r
    where ${scoped("r.entity_id", scope)}
      and ${cycleFilter}
      and ${fundFilter}
    order by
      case r.entity_type when 'group' then 0 when 'sub_group' then 1 when 'campus' then 2
                         when 'ministry_expression' then 3 when 'event' then 4 else 5 end,
      r.entity_name`;
}

export async function getOpenApprovedBudgetLines(scope: Scope, entityId?: string) {
  const entityFilter = entityId ? sql`bl.entity_id = ${entityId}` : sql`true`;
  return sql`
    select bl.id, bc.fiscal_year, bl.entity_id, e.name as entity_name,
           a.code as account_code, a.name as account_name, a.fund_classification,
           bl.proposed_amount, bl.approved_amount,
           public.budget_line_actuals(bl.id) as actual_amount
    from public.budget_lines bl
    join public.budget_cycles bc on bc.id = bl.budget_cycle_id
    join public.entities e on e.id = bl.entity_id
    join public.accounts a on a.id = bl.account_id
    where bc.status in ('open_for_submission','under_review','approved')
      and bl.approved_amount is not null
      and ${scoped("bl.entity_id", scope)}
      and ${entityFilter}
    order by bc.fiscal_year desc, e.name, a.code`;
}

export async function checkBudgetRequisition(budgetLineId: string, amount: string) {
  const [row] = await sql<{
    enforcement_mode: string;
    approved_amount: string | null;
    running_actual: string;
    projected_actual: string;
    exceeds_budget: boolean;
    warning: string | null;
  }[]>`select * from public.check_budget_requisition(${budgetLineId}, ${amount})`;
  return row ?? null;
}
