import "server-only";
import { sql, type Exec } from "./db";

type Scope = "all" | string[];
const scoped = (col: string, scope: Scope) =>
  scope === "all"
    ? sql`true`
    : scope.length === 0
      ? sql`false`
      : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export async function getGovernanceDashboard(scope: Scope) {
  const [nfiu, scuml, wht, related, conflicts, whistleblower] = await Promise.all([
    sql`select * from public.nfiu_flagged_transactions where ${scoped("entity_id", scope)} order by transaction_date desc limit 50`,
    sql`select scl.*, e.name as entity_name from public.scuml_compliance_log scl join public.entities e on e.id = scl.entity_id where ${scoped("scl.entity_id", scope)} order by coalesce(next_filing_due_date, registration_date) nulls last`,
    sql`select * from public.wht_remittance_dashboard where ${scoped("entity_id", scope)} order by is_overdue desc, remittance_month desc`,
    sql`select rpd.*, v.name as vendor_name, e.name as entity_name from public.related_party_disclosures rpd join public.vendors v on v.id = rpd.vendor_id left join public.entities e on e.id = rpd.entity_id where ${scope === "all" ? sql`true` : scope.length === 0 ? sql`false` : sql`(rpd.entity_id is null or rpd.entity_id in ${sql(scope)})`} order by rpd.created_at desc`,
    sql`select coi.*, u.email as trustee_email, s.full_name as staff_name, reviewer.email as reviewed_by_email
        from public.conflict_of_interest_registry coi
        left join public.app_users u on u.id = coi.trustee_id
        left join public.staff s on s.id = coi.staff_id
        left join public.app_users reviewer on reviewer.id = coi.reviewed_by
        order by coi.date_declared desc`,
    sql`select id, is_anonymous, category, status, received_at, reviewed_at
        from public.whistleblower_reports order by received_at desc limit 25`,
  ]);
  return { nfiu, scuml, wht, related, conflicts, whistleblower };
}

export async function getEntitiesForGovernance(scope: Scope) {
  return sql`
    select id, name, legal_status, statutory_jurisdiction
    from public.entities
    where is_active and ${scoped("id", scope)}
    order by name`;
}

export async function getStaffForGovernance(scope: Scope) {
  return sql`
    select s.id, s.full_name, e.name as entity_name
    from public.staff s
    join public.entities e on e.id = s.entity_id
    where ${scoped("s.entity_id", scope)}
    order by s.full_name`;
}

export async function getTrusteeUsers() {
  return sql`
    select distinct u.id, u.email
    from public.user_entity_roles uer
    join public.app_users u on u.id = uer.user_id
    where uer.role in ('board_trustee','governance_officer','auditor')
    order by u.email`;
}

export async function upsertScumlLog(
  d: {
    entityId: string;
    registrationStatus: string;
    registrationNumber: string | null;
    registrationDate: string | null;
    lastFilingDate: string | null;
    nextFilingDueDate: string | null;
    notes: string | null;
    reviewer: string;
  },
  exec: Exec = sql
) {
  await exec`
    insert into public.scuml_compliance_log
      (entity_id, registration_status, registration_number, registration_date,
       last_filing_date, next_filing_due_date, notes, reviewed_by, reviewed_at)
    values
      (${d.entityId}, ${d.registrationStatus}::public.scuml_status, ${d.registrationNumber},
       ${d.registrationDate}::date, ${d.lastFilingDate}::date, ${d.nextFilingDueDate}::date,
       ${d.notes}, ${d.reviewer}, now())`;
}

export async function createConflictOfInterest(
  d: {
    trusteeId: string | null;
    staffId: string | null;
    declaredInterest: string;
    dateDeclared: string;
  },
  exec: Exec = sql
) {
  await exec`
    insert into public.conflict_of_interest_registry
      (trustee_id, staff_id, declared_interest, date_declared)
    values (${d.trusteeId}, ${d.staffId}, ${d.declaredInterest}, ${d.dateDeclared}::date)`;
}

export async function reviewConflictOfInterest(
  id: string,
  reviewer: string,
  status: string,
  exec: Exec = sql
) {
  await exec`
    update public.conflict_of_interest_registry
       set reviewed_by = ${reviewer}, reviewed_at = now(), status = ${status}
     where id = ${id}`;
}

export async function createWhistleblowerReport(
  d: {
    anonymous: boolean;
    reporterUserId: string | null;
    reporterContact: string | null;
    category: string;
    description: string;
  },
  exec: Exec = sql
) {
  await exec`
    insert into public.whistleblower_reports
      (is_anonymous, reporter_user_id, reporter_contact, category, description)
    values
      (${d.anonymous}, ${d.reporterUserId}, ${d.reporterContact},
       ${d.category}::public.whistleblower_category, ${d.description})`;
}

export async function updateWhistleblowerStatus(
  id: string,
  status: string,
  reviewer: string,
  resolutionNote: string | null,
  exec: Exec = sql
) {
  await exec`
    update public.whistleblower_reports
       set status = ${status}::public.whistleblower_status,
           reviewed_by = ${reviewer},
           reviewed_at = now(),
           resolution_note = ${resolutionNote}
     where id = ${id}`;
}

export async function getAuditLogRows(d: {
  scope: Scope;
  entityId?: string | null;
  actorId?: string | null;
  action?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const entityFilter = d.entityId ? sql`al.entity_id = ${d.entityId}` : scoped("al.entity_id", d.scope);
  const actorFilter = d.actorId ? sql`al.actor_id = ${d.actorId}` : sql`true`;
  const actionFilter = d.action ? sql`al.action = ${d.action}` : sql`true`;
  const startFilter = d.startDate ? sql`al.occurred_at::date >= ${d.startDate}::date` : sql`true`;
  const endFilter = d.endDate ? sql`al.occurred_at::date <= ${d.endDate}::date` : sql`true`;
  return sql`
    select al.id, al.occurred_at, al.actor_id, u.email as actor_email,
           al.action, al.table_name, al.record_id, al.entity_id, e.name as entity_name,
           al.note
    from public.audit_log al
    left join public.app_users u on u.id = al.actor_id
    left join public.entities e on e.id = al.entity_id
    where ${entityFilter} and ${actorFilter} and ${actionFilter} and ${startFilter} and ${endFilter}
    order by al.occurred_at desc
    limit 500`;
}
