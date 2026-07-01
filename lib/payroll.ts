import "server-only";
import { sql, type Exec } from "./db";

type Scope = "all" | string[];
const scoped = (col: string, scope: Scope) =>
  scope === "all"
    ? sql`true`
    : scope.length === 0
      ? sql`false`
      : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export async function getPayrollEntities(scope: Scope) {
  return sql`
    select id, name, type, functional_currency
    from public.entities
    where is_active and ${scoped("id", scope)}
    order by name`;
}

export async function getStaff(scope: Scope) {
  return sql`
    select s.id, s.full_name, s.staff_type, s.employment_status, s.state_of_taxation,
           s.pfa_provider, s.pension_id, e.name as entity_name,
           coalesce(sum(c.amount), 0) as gross_compensation,
           count(c.id)::int as component_count
    from public.staff s
    join public.entities e on e.id = s.entity_id
    left join public.compensation_components c on c.staff_id = s.id
    where ${scoped("s.entity_id", scope)}
    group by s.id, e.name
    order by s.full_name`;
}

export async function createStaff(
  d: {
    entityId: string;
    fullName: string;
    staffType: string;
    employmentStatus: string;
    state: string | null;
    pfaProvider: string | null;
    pensionId: string | null;
  },
  exec: Exec = sql
) {
  const [row] = await exec<{ id: string }[]>`
    insert into public.staff
      (entity_id, full_name, staff_type, employment_status, state_of_taxation, pfa_provider, pension_id)
    values
      (${d.entityId}, ${d.fullName}, ${d.staffType}::public.staff_type,
       ${d.employmentStatus}::public.employment_status, ${d.state}, ${d.pfaProvider}, ${d.pensionId})
    returning id`;
  return row.id;
}

export async function addCompensationComponent(
  d: { staffId: string; componentType: string; amount: string; currency: string; taxable: boolean },
  exec: Exec = sql
) {
  await exec`
    insert into public.compensation_components
      (staff_id, component_type, amount, currency, is_taxable)
    values
      (${d.staffId}, ${d.componentType}::public.compensation_component_type,
       ${d.amount}, ${d.currency}, ${d.taxable})`;
}

export async function createPayrollRun(
  d: { entityId: string; month: string; year: string; actor: string },
  exec: Exec = sql
) {
  const [row] = await exec<{ create_payroll_run: string }[]>`
    select public.create_payroll_run(${d.entityId}, ${d.month}, ${d.year}, ${d.actor})`;
  return row.create_payroll_run;
}

export async function approvePayrollRun(id: string, actor: string, exec: Exec = sql) {
  await exec`select public.approve_payroll_run(${id}, ${actor})`;
}

export async function getPayrollRuns(scope: Scope) {
  return sql`
    select pr.id, e.name as entity_name, pr.period_month, pr.period_year, pr.status,
           pr.approved_at, pr.journal_entry_id,
           count(li.staff_id)::int as line_count,
           coalesce(sum(li.gross_amount), 0) as gross_amount,
           coalesce(sum(li.paye_deducted + li.pension_deducted + li.nhf_deducted), 0) as deductions,
           coalesce(sum(li.net_amount), 0) as net_amount
    from public.payroll_runs pr
    join public.entities e on e.id = pr.entity_id
    left join public.payroll_line_items li on li.payroll_run_id = pr.id
    where ${scoped("pr.entity_id", scope)}
    group by pr.id, e.name
    order by pr.period_year desc, pr.period_month desc, pr.created_at desc`;
}

export async function getPayrollRunLines(runId: string) {
  return sql`
    select li.*, s.full_name, s.staff_type, s.state_of_taxation
    from public.payroll_line_items li
    join public.staff s on s.id = li.staff_id
    where li.payroll_run_id = ${runId}
    order by s.full_name`;
}

export async function getHonorariums(scope: Scope) {
  return sql`
    select hp.id, hp.recipient_name, hp.recipient_type, hp.amount, hp.currency,
           hp.wht_amount, hp.payment_date, hp.status, hp.journal_entry_id,
           e.name as entity_name, ev.name as event_name,
           coalesce(next.approver_role::text, 'complete') as next_approver_role
    from public.honorarium_payments hp
    join public.entities e on e.id = hp.entity_id
    left join public.entities ev on ev.id = hp.event_id
    left join lateral (
      select approver_role
      from public.honorarium_approvals ha
      where ha.honorarium_payment_id = hp.id and ha.status = 'pending'
        and not exists (
          select 1 from public.honorarium_approvals prev
          where prev.honorarium_payment_id = hp.id
            and prev.sequence_order < ha.sequence_order
            and prev.status <> 'approved'
        )
      order by sequence_order
      limit 1
    ) next on true
    where ${scoped("hp.entity_id", scope)}
    order by hp.created_at desc`;
}

export async function createHonorarium(
  d: {
    entityId: string;
    recipientName: string;
    recipientType: string;
    amount: string;
    currency: string;
    eventId: string | null;
    whtApplicable: boolean;
    whtAmount: string;
    paymentDate: string;
    actor: string;
  },
  exec: Exec = sql
) {
  const [row] = await exec<{ id: string }[]>`
    insert into public.honorarium_payments
      (entity_id, recipient_name, recipient_type, amount, currency, event_id,
       wht_applicable, wht_amount, payment_date, created_by)
    values
      (${d.entityId}, ${d.recipientName}, ${d.recipientType}::public.honorarium_recipient_type,
       ${d.amount}, ${d.currency}, ${d.eventId}, ${d.whtApplicable}, ${d.whtAmount},
       ${d.paymentDate}::date, ${d.actor})
    returning id`;
  await exec`select public.generate_honorarium_approvals(${row.id})`;
  return row.id;
}

export async function getHonorariumApprovalInbox(roles: string[]) {
  if (roles.length === 0) return [];
  return sql`
    select ha.id, ha.approver_role, ha.sequence_order, hp.recipient_name, hp.recipient_type,
           hp.amount, hp.currency, hp.wht_amount, hp.payment_date, e.name as entity_name
    from public.honorarium_approvals ha
    join public.honorarium_payments hp on hp.id = ha.honorarium_payment_id
    join public.entities e on e.id = hp.entity_id
    where ha.status = 'pending' and ha.approver_role in ${sql(roles)}
      and not exists (
        select 1 from public.honorarium_approvals prev
        where prev.honorarium_payment_id = hp.id
          and prev.sequence_order < ha.sequence_order
          and prev.status <> 'approved'
      )
    order by hp.amount desc, hp.created_at`;
}

export async function decideHonorarium(
  id: string,
  actor: string,
  decision: "approved" | "rejected",
  comments: string | null,
  exec: Exec = sql
) {
  await exec`
    select public.decide_honorarium_approval(${id}, ${actor}, ${decision}::public.approval_status, ${comments})`;
}

export async function postHonorarium(id: string, actor: string, exec: Exec = sql) {
  await exec`select public.post_honorarium_payment(${id}, ${actor})`;
}
