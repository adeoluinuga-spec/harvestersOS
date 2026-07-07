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

export async function submitPayrollRun(id: string, actor: string, exec: Exec = sql) {
  await exec`select public.submit_payroll_run(${id}, ${actor})`;
}

export async function rejectPayrollRun(id: string, actor: string, reason: string, exec: Exec = sql) {
  await exec`select public.reject_payroll_run(${id}, ${actor}, ${reason})`;
}

/** Paginated runs, scope-filtered. */
export async function getPayrollRuns(scope: Scope, page = 1, pageSize = 20) {
  const where = sql`${scoped("pr.entity_id", scope)}`;
  const [rows, count] = await Promise.all([
    sql`
      select pr.id, pr.entity_id, e.name as entity_name, pr.period_month, pr.period_year,
             pr.status, pr.approver_role, pr.rejection_reason, pr.approved_at, pr.journal_entry_id,
             count(li.staff_id)::int as line_count,
             coalesce(sum(li.gross_amount), 0) as gross_amount,
             coalesce(sum(li.paye_deducted + li.pension_deducted + li.nhf_deducted + li.other_deductions), 0) as deductions,
             coalesce(sum(li.net_amount), 0) as net_amount
      from public.payroll_runs pr
      join public.entities e on e.id = pr.entity_id
      left join public.payroll_line_items li on li.payroll_run_id = pr.id
      where ${where}
      group by pr.id, e.name
      order by pr.period_year desc, pr.period_month desc, pr.created_at desc
      limit ${pageSize} offset ${(page - 1) * pageSize}`,
    sql<{ n: number }[]>`
      select count(*)::int n from public.payroll_runs pr where ${where}`,
  ]);
  return { rows, total: count[0]?.n ?? 0 };
}

// ---------------------------------------------------------------------------
// Cadre drill-down: Groups / Central Office / Ministries → … → campuses.
// One query, scope-filtered; the tree is assembled from parentage.
// ---------------------------------------------------------------------------
export type CadreNode = {
  id: string;
  name: string;
  type: string;
  parent_entity_id: string | null;
  staff_count: number;
  monthly_net: string;
  latest_run_status: string | null;
  latest_run_id: string | null;
  latest_period: string | null;
  children: CadreNode[];
};

export async function getPayrollCadreTree(scope: Scope): Promise<CadreNode[]> {
  const rows = await sql<Array<Omit<CadreNode, "children">>>`
    select e.id, e.name, e.type::text, e.parent_entity_id,
           coalesce(s.n, 0)::int as staff_count,
           coalesce(s.net, 0)::text as monthly_net,
           lr.status::text as latest_run_status,
           lr.id as latest_run_id,
           case when lr.id is null then null
                else to_char(make_date(lr.period_year, lr.period_month, 1), 'Mon YYYY') end as latest_period
    from public.entities e
    left join lateral (
      select count(*)::int as n,
             coalesce(sum(cc.total), 0) as net
      from public.staff st
      left join lateral (
        select sum(amount) as total from public.compensation_components c where c.staff_id = st.id
      ) cc on true
      where st.entity_id = e.id and st.employment_status = 'employed'
    ) s on true
    left join lateral (
      select pr.id, pr.status, pr.period_month, pr.period_year
      from public.payroll_runs pr where pr.entity_id = e.id
      order by pr.period_year desc, pr.period_month desc limit 1
    ) lr on true
    where e.is_active and e.type <> 'event'
      and ${scoped("e.id", scope)}
    order by e.name`;

  const byId = new Map<string, CadreNode>(
    rows.map((r) => [r.id, { ...r, children: [] as CadreNode[] }])
  );
  const roots: CadreNode[] = [];
  byId.forEach((node) => {
    const parent = node.parent_entity_id ? byId.get(node.parent_entity_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  // Aggregate staff counts up the tree so cadre cards show their whole scope.
  const rollup = (n: CadreNode): { staff: number; net: number } => {
    let staff = n.staff_count;
    let net = Number(n.monthly_net);
    for (const c of n.children) {
      const r = rollup(c);
      staff += r.staff;
      net += r.net;
    }
    n.staff_count = staff;
    n.monthly_net = String(net);
    return { staff, net };
  };
  roots.forEach(rollup);
  return roots;
}

// ---------------------------------------------------------------------------
// Entity payroll analysis: monthly history + staff, exportable.
// ---------------------------------------------------------------------------
export async function getEntityPayrollHistory(entityId: string) {
  return sql`
    select pr.id, pr.period_month, pr.period_year, pr.status::text,
           count(li.staff_id)::int as headcount,
           coalesce(sum(li.gross_amount), 0) as gross,
           coalesce(sum(li.paye_deducted), 0) as paye,
           coalesce(sum(li.pension_deducted), 0) as pension,
           coalesce(sum(li.nhf_deducted), 0) as nhf,
           coalesce(sum(li.other_deductions), 0) as other_deductions,
           coalesce(sum(li.net_amount), 0) as net
    from public.payroll_runs pr
    left join public.payroll_line_items li on li.payroll_run_id = pr.id
    where pr.entity_id = ${entityId}
    group by pr.id
    order by pr.period_year desc, pr.period_month desc`;
}

export async function getRun(runId: string) {
  const [run] = await sql`
    select pr.*, e.name as entity_name, e.functional_currency,
           sb.email as submitted_by_email, ab.email as approved_by_email
    from public.payroll_runs pr
    join public.entities e on e.id = pr.entity_id
    left join public.app_users sb on sb.id = pr.submitted_by
    left join public.app_users ab on ab.id = pr.approved_by
    where pr.id = ${runId}`;
  return run ?? null;
}

export async function getRunBatches(runId: string) {
  return sql`
    select b.*, ba.bank_name, ba.account_number_last4,
           (select count(*) from public.payroll_batch_signatures s where s.batch_id = b.id)::int as signature_count
    from public.payroll_payment_batches b
    left join public.bank_accounts ba on ba.id = b.bank_account_id
    where b.payroll_run_id = ${runId}
    order by b.cycle_no`;
}

export async function getBatchPayments(batchId: string) {
  return sql`
    select plp.id, plp.amount, plp.status::text, plp.status_note, s.full_name
    from public.payroll_line_payments plp
    join public.staff s on s.id = plp.staff_id
    where plp.batch_id = ${batchId}
    order by s.full_name`;
}

// ---------------------------------------------------------------------------
// Adjustments (HR's calculator: one-off earnings/deductions per period).
// ---------------------------------------------------------------------------
export async function getAdjustments(entityId: string, month: number, year: number) {
  return sql`
    select a.id, a.kind::text, a.label, a.amount, a.is_taxable, a.note, s.full_name, a.staff_id
    from public.payroll_adjustments a
    join public.staff s on s.id = a.staff_id
    where s.entity_id = ${entityId} and a.period_month = ${month} and a.period_year = ${year}
    order by s.full_name, a.created_at`;
}

export async function addAdjustment(
  d: {
    staffId: string;
    month: number;
    year: number;
    kind: "earning" | "deduction";
    label: string;
    amount: string;
    taxable: boolean;
    note: string | null;
    actor: string;
  },
  exec: Exec = sql
) {
  await exec`
    insert into public.payroll_adjustments
      (staff_id, period_month, period_year, kind, label, amount, is_taxable, note, created_by)
    values (${d.staffId}, ${d.month}, ${d.year}, ${d.kind}::public.payroll_adjustment_kind,
            ${d.label}, ${d.amount}, ${d.taxable}, ${d.note}, ${d.actor})`;
}

export async function deleteAdjustment(id: string, exec: Exec = sql) {
  await exec`delete from public.payroll_adjustments where id = ${id}`;
}

// ---------------------------------------------------------------------------
// Batch/payment operations (delegate to the sanctioned SQL functions).
// ---------------------------------------------------------------------------
export async function markBatchUploaded(
  d: { batchId: string; bankAccountId: string; uploadRef: string; instructionRef: string; actor: string },
  exec: Exec = sql
) {
  await exec`
    select public.mark_payroll_batch_uploaded(
      ${d.batchId}, ${d.bankAccountId}, ${d.uploadRef}, ${d.instructionRef}, ${d.actor})`;
}

export async function signBatch(batchId: string, actor: string, exec: Exec = sql) {
  await exec`select public.sign_payroll_batch(${batchId}, ${actor})`;
}

export async function disburseBatch(batchId: string, actor: string, exec: Exec = sql) {
  await exec`select public.disburse_payroll_batch(${batchId}, ${actor})`;
}

export async function markPayment(
  d: { paymentId: string; status: "successful" | "returned" | "contested"; note: string | null; actor: string },
  exec: Exec = sql
) {
  await exec`
    select public.mark_payroll_payment(${d.paymentId}, ${d.status}::public.payroll_payment_status, ${d.note}, ${d.actor})`;
}

export async function reissuePayment(paymentId: string, actor: string, exec: Exec = sql) {
  await exec`select public.reissue_payroll_payment(${paymentId}, ${actor})`;
}

export async function createSupplementaryBatch(
  entityId: string, plannedDate: string, actor: string, exec: Exec = sql
) {
  await exec`select public.create_supplementary_payroll_batch(${entityId}, ${plannedDate}::date, ${actor})`;
}

/** The campus/ministry payment-status board + open batches, scope-filtered. */
export async function getPaymentStatusBoard(scope: Scope) {
  return sql`
    select * from public.payroll_payment_status_rollup
    where ${scoped("entity_id", scope)}
    order by planned_date desc, entity_name
    limit 200`;
}

export async function getOpenBatches(scope: Scope) {
  return sql`
    select b.id, b.entity_id, e.name as entity_name, b.planned_date, b.cycle_no,
           b.status::text, b.total_amount, b.bank_account_id,
           ba.bank_name, ba.account_number_last4,
           pr.period_month, pr.period_year
    from public.payroll_payment_batches b
    join public.entities e on e.id = b.entity_id
    join public.payroll_runs pr on pr.id = b.payroll_run_id
    left join public.bank_accounts ba on ba.id = b.bank_account_id
    where b.status <> 'disbursed' and ${scoped("b.entity_id", scope)}
    order by b.planned_date, e.name`;
}

/** Approval inbox for pastors/heads: pending runs where the caller holds the approver role. */
export async function getPayrollApprovalInbox(scope: Scope, roles: string[]) {
  if (roles.length === 0) return [];
  return sql`
    select pr.id, pr.entity_id, e.name as entity_name, pr.period_month, pr.period_year,
           pr.approver_role::text, pr.submitted_at,
           count(li.staff_id)::int as headcount,
           coalesce(sum(li.net_amount), 0) as net
    from public.payroll_runs pr
    join public.entities e on e.id = pr.entity_id
    left join public.payroll_line_items li on li.payroll_run_id = pr.id
    where pr.status = 'pending_approval'
      and pr.approver_role::text in ${sql(roles)}
      and ${scoped("pr.entity_id", scope)}
    group by pr.id, e.name
    order by pr.submitted_at`;
}

export async function getPayrollSettings() {
  const [row] = await sql`select * from public.payroll_settings where id = 1`;
  return row;
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
