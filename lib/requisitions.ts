import "server-only";
import { sql, type Exec } from "./db";

type Scope = "all" | string[];
const scoped = (col: string, scope: Scope) =>
  scope === "all"
    ? sql`true`
    : scope.length === 0
      ? sql`false`
      : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export type EntityPick = {
  id: string;
  name: string;
  type: string;
  functional_currency: string;
};

export type VendorPick = {
  id: string;
  name: string;
  tax_id: string | null;
  is_related_party: boolean;
  bank_account_number_last4: string | null;
};

export type RequestRow = {
  id: string;
  entity_id: string;
  entity_name: string;
  raised_by_email: string | null;
  category: string;
  description: string;
  amount: string;
  net_payable_amount: string;
  wht_withheld_amount: string;
  currency: string;
  status: string;
  is_urgent: boolean;
  needed_by_date: string | null;
  created_at: string;
  vendor_name: string | null;
  related_party_disclosure_note: string | null;
};

export type ApprovalInboxRow = {
  id: string;
  sequence_order: number;
  approver_role: string;
  is_board_step: boolean;
  subject_type: "batch" | "request";
  subject_id: string;
  entity_name: string;
  title: string;
  amount: string;
  currency: string;
  is_urgent: boolean;
  prior_steps: number;
};

export type BatchRow = {
  id: string;
  entity_name: string;
  batch_date: string;
  total_amount: string;
  currency: string;
  status: string;
  item_count: number;
};

export type DisbursementRow = {
  id: string;
  subject_type: string;
  subject_id: string;
  entity_name: string;
  bank_name: string;
  account_number_last4: string | null;
  gross_amount: string;
  wht_withheld_amount: string;
  net_payable_amount: string;
  disbursement_status: string;
  created_at: string;
};

export async function getRequisitionEntities(scope: Scope): Promise<EntityPick[]> {
  return sql<EntityPick[]>`
    select id, name, type, functional_currency
    from public.entities
    where is_active and ${scoped("id", scope)}
    order by name`;
}

export async function getVendors(): Promise<VendorPick[]> {
  return sql<VendorPick[]>`
    select id, name, tax_id, is_related_party, bank_account_number_last4
    from public.vendors order by name`;
}

export async function getBankAccounts(scope: Scope) {
  return sql`
    select ba.id, ba.bank_name, ba.account_number_last4, ba.currency, e.name as entity_name, ba.entity_id
    from public.bank_accounts ba
    join public.entities e on e.id = ba.entity_id
    where ba.is_active and ${scoped("ba.entity_id", scope)}
    order by e.name, ba.bank_name`;
}

export async function getUsers() {
  return sql`select id, email from auth.users order by email`;
}

export async function createVendor(
  d: { name: string; account: string; taxId: string | null; related: boolean },
  exec: Exec = sql
) {
  const [row] = await exec<{ create_vendor: string }[]>`
    select public.create_vendor(${d.name}, ${d.account}, ${d.taxId}, ${d.related})`;
  return row.create_vendor;
}

export async function createRequest(
  d: {
    entityId: string;
    raisedBy: string;
    raisedByRole: string;
    orgBranch: string;
    raisedByLevel: string;
    vendorId: string | null;
    category: string;
    description: string;
    amount: string;
    currency: string;
    neededBy: string | null;
    urgent: boolean;
    whtApplicable: boolean;
    whtRate: string;
    budgetLineId?: string | null;
    relatedPartyDisclosureNote?: string | null;
  },
  exec: Exec = sql
) {
  const relatedPartyDisclosureNote = d.relatedPartyDisclosureNote ?? null;
  const rows = (await exec`
    insert into public.requisition_requests
      (entity_id, raised_by, raised_by_role, org_branch, raised_by_level, vendor_id, budget_line_id,
       category, description, amount, currency, needed_by_date, is_urgent, wht_applicable, wht_rate,
       related_party_disclosure_note)
    values
      (${d.entityId}, ${d.raisedBy}, ${d.raisedByRole}::public.app_role,
       ${d.orgBranch}::public.org_branch, ${d.raisedByLevel}::public.raised_by_level,
       ${d.vendorId}, ${d.budgetLineId ?? null}, ${d.category}, ${d.description}, ${d.amount}, ${d.currency},
       ${d.neededBy}::date, ${d.urgent}, ${d.whtApplicable}, ${d.whtRate}, ${relatedPartyDisclosureNote})
    returning id`) as { id: string }[];
  const [row] = rows;
  if (d.urgent) {
    await exec`select public.generate_requisition_approvals(null, ${row.id})`;
  }
  return row.id;
}

export async function getRequests(scope: Scope, limit = 50): Promise<RequestRow[]> {
  return sql<RequestRow[]>`
    select rr.id, rr.entity_id, e.name as entity_name, u.email as raised_by_email,
           rr.category, rr.description, rr.amount, rr.net_payable_amount,
           rr.wht_withheld_amount, rr.currency, rr.status, rr.is_urgent,
           rr.needed_by_date, rr.created_at, v.name as vendor_name,
           rr.related_party_disclosure_note
    from public.requisition_requests rr
    join public.entities e on e.id = rr.entity_id
    left join auth.users u on u.id = rr.raised_by
    left join public.vendors v on v.id = rr.vendor_id
    where ${scoped("rr.entity_id", scope)}
    order by rr.is_urgent desc, rr.created_at desc
    limit ${limit}`;
}

export async function getMyRequests(userId: string): Promise<RequestRow[]> {
  return sql<RequestRow[]>`
    select rr.id, rr.entity_id, e.name as entity_name, u.email as raised_by_email,
           rr.category, rr.description, rr.amount, rr.net_payable_amount,
           rr.wht_withheld_amount, rr.currency, rr.status, rr.is_urgent,
           rr.needed_by_date, rr.created_at, v.name as vendor_name,
           rr.related_party_disclosure_note
    from public.requisition_requests rr
    join public.entities e on e.id = rr.entity_id
    left join auth.users u on u.id = rr.raised_by
    left join public.vendors v on v.id = rr.vendor_id
    where rr.raised_by = ${userId}
    order by rr.created_at desc`;
}

export async function getCompileQueue(scope: Scope) {
  return sql<RequestRow[]>`
    select rr.id, rr.entity_id, e.name as entity_name, u.email as raised_by_email,
           rr.category, rr.description, rr.amount, rr.net_payable_amount,
           rr.wht_withheld_amount, rr.currency, rr.status, rr.is_urgent,
           rr.needed_by_date, rr.created_at, v.name as vendor_name,
           rr.related_party_disclosure_note
    from public.requisition_requests rr
    join public.entities e on e.id = rr.entity_id
    left join auth.users u on u.id = rr.raised_by
    left join public.vendors v on v.id = rr.vendor_id
    where rr.status = 'submitted' and rr.is_urgent = false and ${scoped("rr.entity_id", scope)}
    order by rr.needed_by_date nulls last, rr.created_at`;
}

export async function createBatch(
  d: { requestIds: string[]; compiledBy: string },
  exec: Exec = sql
) {
  const rows = await exec<
    { entity_id: string; currency: string; org_branch: string; raised_by_level: string; total: string }[]
  >`
    select entity_id, currency, org_branch, raised_by_level, sum(amount) as total
    from public.requisition_requests
    where id in ${exec(d.requestIds)} and status = 'submitted' and is_urgent = false
    group by entity_id, currency, org_branch, raised_by_level`;
  if (rows.length !== 1) {
    throw new Error("Select requests from the same entity, currency, branch, and level.");
  }
  const r = rows[0];
  const [batch] = await exec<{ id: string }[]>`
    insert into public.requisition_batches
      (entity_id, compiled_by, total_amount, currency, org_branch, raised_by_level)
    values (${r.entity_id}, ${d.compiledBy}, ${r.total}, ${r.currency},
            ${r.org_branch}::public.org_branch, ${r.raised_by_level}::public.raised_by_level)
    returning id`;
  for (const id of d.requestIds) {
    await exec`
      insert into public.requisition_batch_items (batch_id, requisition_request_id)
      values (${batch.id}, ${id})`;
  }
  await exec`
    update public.requisition_requests set status = 'compiled'
    where id in ${exec(d.requestIds)}`;
  await exec`select public.generate_requisition_approvals(${batch.id}, null)`;
  return batch.id;
}

export async function getBatches(scope: Scope): Promise<BatchRow[]> {
  return sql<BatchRow[]>`
    select rb.id, e.name as entity_name, rb.batch_date, rb.total_amount, rb.currency, rb.status,
           count(bi.requisition_request_id)::int as item_count
    from public.requisition_batches rb
    join public.entities e on e.id = rb.entity_id
    left join public.requisition_batch_items bi on bi.batch_id = rb.id
    where ${scoped("rb.entity_id", scope)}
    group by rb.id, e.name
    order by rb.created_at desc`;
}

export async function getApprovalInbox(roles: string[]): Promise<ApprovalInboxRow[]> {
  if (roles.length === 0) return [];
  return sql<ApprovalInboxRow[]>`
    select ra.id, ra.sequence_order, ra.approver_role, ra.is_board_step,
           case when ra.requisition_batch_id is null then 'request' else 'batch' end as subject_type,
           coalesce(ra.requisition_request_id, ra.requisition_batch_id) as subject_id,
           e.name as entity_name,
           coalesce(rr.description, 'Compiled batch: ' || count(bi.requisition_request_id)::text || ' requests') as title,
           coalesce(rr.amount, rb.total_amount) as amount,
           coalesce(rr.currency, rb.currency) as currency,
           coalesce(rr.is_urgent, bool_or(item.is_urgent), false) as is_urgent,
           count(prev.id)::int as prior_steps
    from public.requisition_approvals ra
    left join public.requisition_requests rr on rr.id = ra.requisition_request_id
    left join public.requisition_batches rb on rb.id = ra.requisition_batch_id
    left join public.requisition_batch_items bi on bi.batch_id = rb.id
    left join public.requisition_requests item on item.id = bi.requisition_request_id
    join public.entities e on e.id = coalesce(rr.entity_id, rb.entity_id)
    left join public.requisition_approvals prev
      on prev.sequence_order < ra.sequence_order
     and prev.requisition_batch_id is not distinct from ra.requisition_batch_id
     and prev.requisition_request_id is not distinct from ra.requisition_request_id
     and prev.status <> 'approved'
    where ra.status = 'pending' and ra.approver_role in ${sql(roles)}
    group by ra.id, e.name, rr.id, rb.id
    having count(prev.id) = 0
    order by coalesce(rr.is_urgent, bool_or(item.is_urgent), false) desc, ra.sequence_order, min(coalesce(rr.created_at, rb.created_at))`;
}

export async function decideApproval(
  id: string,
  actor: string,
  decision: "approved" | "rejected",
  comments: string | null,
  exec: Exec = sql
) {
  await exec`
    select public.decide_requisition_approval(${id}, ${actor}, ${decision}::public.approval_status, ${comments})`;
}

export async function getFinanceQueue(scope: Scope) {
  return sql`
    select 'request' as subject_type, rr.id as subject_id, e.name as entity_name, rr.description as title,
           rr.amount as gross_amount, rr.wht_withheld_amount, rr.net_payable_amount, rr.currency, rr.is_urgent
    from public.requisition_requests rr
    join public.entities e on e.id = rr.entity_id
    where rr.status = 'approved' and rr.id not in (
      select requisition_request_id from public.disbursement_records where requisition_request_id is not null
    ) and ${scoped("rr.entity_id", scope)}
    union all
    select 'batch', rb.id, e.name, 'Compiled batch', rb.total_amount, coalesce(sum(rr.wht_withheld_amount),0),
           rb.total_amount - coalesce(sum(rr.wht_withheld_amount),0), rb.currency, bool_or(rr.is_urgent)
    from public.requisition_batches rb
    join public.entities e on e.id = rb.entity_id
    join public.requisition_batch_items bi on bi.batch_id = rb.id
    join public.requisition_requests rr on rr.id = bi.requisition_request_id
    where rb.status = 'fully_approved' and rb.id not in (
      select requisition_batch_id from public.disbursement_records where requisition_batch_id is not null
    ) and ${scoped("rb.entity_id", scope)}
    group by rb.id, e.name`;
}

export async function createDisbursement(
  d: {
    subjectType: string;
    subjectId: string;
    bankAccountId: string;
    actor: string;
    uploadRef: string | null;
    instructionRef: string | null;
  },
  exec: Exec = sql
) {
  const [amounts] = await exec<
    { gross: string; wht: string; net: string }[]
  >`
    select gross, wht, net from (
      select rr.id, 'request' as t, rr.amount as gross, rr.wht_withheld_amount as wht, rr.net_payable_amount as net
      from public.requisition_requests rr
      union all
      select rb.id, 'batch', rb.total_amount, coalesce(sum(rr.wht_withheld_amount),0),
             rb.total_amount - coalesce(sum(rr.wht_withheld_amount),0)
      from public.requisition_batches rb
      join public.requisition_batch_items bi on bi.batch_id = rb.id
      join public.requisition_requests rr on rr.id = bi.requisition_request_id
      group by rb.id
    ) x where x.id = ${d.subjectId} and x.t = ${d.subjectType}`;
  if (!amounts) throw new Error("Approved subject not found.");
  const [row] = await exec<{ id: string }[]>`
    insert into public.disbursement_records
      (requisition_batch_id, requisition_request_id, bank_account_id, finance_processed_by,
       bank_upload_reference, transfer_instruction_reference, gross_amount, wht_withheld_amount,
       net_payable_amount, disbursement_status)
    values
      (${d.subjectType === "batch" ? d.subjectId : null},
       ${d.subjectType === "request" ? d.subjectId : null},
       ${d.bankAccountId}, ${d.actor}, ${d.uploadRef}, ${d.instructionRef},
       ${amounts.gross}, ${amounts.wht}, ${amounts.net}, 'pending_signatures')
    returning id`;
  if (d.subjectType === "batch") {
    await exec`
      update public.requisition_requests rr set status = 'sent_to_finance'
      from public.requisition_batch_items bi
      where bi.batch_id = ${d.subjectId} and rr.id = bi.requisition_request_id`;
  } else {
    await exec`update public.requisition_requests set status = 'sent_to_finance' where id = ${d.subjectId}`;
  }
  await exec`select public.refresh_disbursement_status(${row.id})`;
  return row.id;
}

export async function getDisbursements(scope: Scope): Promise<DisbursementRow[]> {
  return sql<DisbursementRow[]>`
    select dr.id,
           case when dr.requisition_batch_id is null then 'request' else 'batch' end as subject_type,
           coalesce(dr.requisition_request_id, dr.requisition_batch_id) as subject_id,
           e.name as entity_name, ba.bank_name, ba.account_number_last4,
           dr.gross_amount, dr.wht_withheld_amount, dr.net_payable_amount,
           dr.disbursement_status, dr.created_at
    from public.disbursement_records dr
    left join public.requisition_requests rr on rr.id = dr.requisition_request_id
    left join public.requisition_batches rb on rb.id = dr.requisition_batch_id
    join public.entities e on e.id = coalesce(rr.entity_id, rb.entity_id)
    join public.bank_accounts ba on ba.id = dr.bank_account_id
    where ${scoped("e.id", scope)}
    order by dr.created_at desc`;
}

export async function getSignatoryQueue(userId: string) {
  return sql`
    select dr.id, dr.net_payable_amount, dr.disbursement_status, ba.bank_name, ba.account_number_last4,
           slot.id as slot_id, slot.slot_label, slot.requires_all_members, e.name as entity_name,
           (select count(*) from public.disbursement_signature_slot_members where slot_id = slot.id)::int as member_count,
           exists (
             select 1 from public.disbursement_signatures s
             where s.disbursement_record_id = dr.id and s.slot_id = slot.id and s.signatory_user_id = ${userId}
           ) as already_signed
    from public.disbursement_records dr
    join public.bank_accounts ba on ba.id = dr.bank_account_id
    join public.disbursement_signature_slots slot on slot.bank_account_id = ba.id
    join public.disbursement_signature_slot_members m on m.slot_id = slot.id and m.user_id = ${userId}
    left join public.requisition_requests rr on rr.id = dr.requisition_request_id
    left join public.requisition_batches rb on rb.id = dr.requisition_batch_id
    join public.entities e on e.id = coalesce(rr.entity_id, rb.entity_id)
    where dr.disbursement_status in ('pending_signatures','fully_signed')
    order by dr.created_at`;
}

export async function signDisbursement(
  d: { disbursementId: string; slotId: string; userId: string; method: string; action: string },
  exec: Exec = sql
) {
  await exec`
    insert into public.disbursement_signatures
      (disbursement_record_id, slot_id, signatory_user_id, action, method)
    values (${d.disbursementId}, ${d.slotId}, ${d.userId},
            ${d.action}::public.disbursement_signature_action,
            ${d.method}::public.disbursement_signature_method)
    on conflict (disbursement_record_id, slot_id, signatory_user_id)
    do update set action = excluded.action, method = excluded.method, signed_at = now()`;
  await exec`select public.refresh_disbursement_status(${d.disbursementId})`;
}

export async function markDisbursed(id: string, actor: string, exec: Exec = sql) {
  await exec`select public.mark_disbursement_disbursed(${id}, ${actor})`;
}

export async function getSignatureSlots(scope: Scope) {
  return sql`
    select slot.id, slot.bank_account_id, slot.slot_label, slot.slot_order, slot.requires_all_members,
           ba.bank_name, ba.account_number_last4, e.name as entity_name,
           count(m.user_id)::int as member_count,
           string_agg(coalesce(u.email, m.user_id::text), ', ' order by u.email) as members
    from public.disbursement_signature_slots slot
    join public.bank_accounts ba on ba.id = slot.bank_account_id
    join public.entities e on e.id = ba.entity_id
    left join public.disbursement_signature_slot_members m on m.slot_id = slot.id
    left join auth.users u on u.id = m.user_id
    where ${scoped("ba.entity_id", scope)}
    group by slot.id, ba.id, e.name
    order by e.name, ba.bank_name, slot.slot_order`;
}

export async function createSignatureSlot(
  d: { bankAccountId: string; label: string; order: string; requiresAll: boolean; memberIds: string[] },
  exec: Exec = sql
) {
  const [slot] = await exec<{ id: string }[]>`
    insert into public.disbursement_signature_slots
      (bank_account_id, slot_label, slot_order, requires_all_members)
    values (${d.bankAccountId}, ${d.label}, ${d.order || "1"}, ${d.requiresAll})
    on conflict (bank_account_id, slot_label) do update
      set slot_order = excluded.slot_order, requires_all_members = excluded.requires_all_members
    returning id`;
  await exec`delete from public.disbursement_signature_slot_members where slot_id = ${slot.id}`;
  for (const userId of d.memberIds) {
    await exec`
      insert into public.disbursement_signature_slot_members (slot_id, user_id)
      values (${slot.id}, ${userId}) on conflict do nothing`;
  }
  return slot.id;
}
