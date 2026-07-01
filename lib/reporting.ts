import "server-only";
import { sql } from "./db";
import type { AuthContext } from "./auth";

export type Scope = "all" | string[];
export type ReportViewType = "legal_statutory" | "operational_ministry" | "programmatic";
export type ExportFormat = "excel" | "pdf";
export type ReportRow = Record<string, string | number | boolean | null>;

const scoped = (col: string, scope: Scope) =>
  scope === "all"
    ? sql`true`
    : scope.length === 0
      ? sql`false`
      : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export function reportScope(ctx: AuthContext): Scope {
  return ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
}

export async function getReportBuilderOptions(scope: Scope) {
  const [statutoryEntities, events, restrictedFunds] = await Promise.all([
    sql`
      select id, name, statutory_jurisdiction, country
      from public.entities
      where legal_status = 'separate_foreign_entity' and ${scoped("id", scope)}
      order by statutory_jurisdiction, name`,
    sql`
      select ed.id, ed.event_name as name, ed.event_type, ed.start_date, ed.end_date,
             ed.hosting_entity_id, host.name as hosting_entity_name
      from public.event_details ed
      join public.entities host on host.id = ed.hosting_entity_id
      where ${scope === "all" ? sql`true` : scope.length === 0 ? sql`false` : sql`(ed.entity_id in ${sql(scope)} or ed.hosting_entity_id in ${sql(scope)})`}
      order by ed.start_date desc, ed.event_name`,
    sql`
      select rf.id, rf.name, rf.entity_id, e.name as entity_name, rf.fund_classification
      from public.restricted_funds rf
      join public.entities e on e.id = rf.entity_id
      where ${scoped("rf.entity_id", scope)}
      order by rf.name`,
  ]);

  return {
    statutoryEntities: normalizeRows(statutoryEntities),
    events: normalizeRows(events),
    restrictedFunds: normalizeRows(restrictedFunds),
  };
}

export async function runReport(input: {
  viewType: ReportViewType;
  startDate: string;
  endDate: string;
  entityId?: string | null;
  programType?: string | null;
  programId?: string | null;
  scope: Scope;
}) {
  if (input.viewType === "legal_statutory") {
    if (!input.entityId) return [];
    assertInScope(input.entityId, input.scope);
    return normalizeRows(await sql`
      select * from public.final_statutory_financial_statement(
        ${input.entityId}, ${input.startDate}::date, ${input.endDate}::date
      )`);
  }

  if (input.viewType === "programmatic") {
    if (!input.programType || !input.programId) return [];
    const rows = normalizeRows(await sql`
      select * from public.final_programmatic_pl(
        ${input.programType}, ${input.programId}, ${input.startDate}::date, ${input.endDate}::date
      )`);
    return scopeRows(rows, input.scope, "host_entity_id");
  }

  const rows = normalizeRows(await sql`
    select * from public.final_operational_ministry_rollup(
      ${input.startDate}::date, ${input.endDate}::date
    )`);
  return scopeRows(rows, input.scope, "entity_id");
}

export async function getExecutiveDashboard(ctx: AuthContext, startDate: string, endDate: string) {
  const scope = reportScope(ctx);
  const [snapshot, pendingApprovals, restrictedFunds, complianceFlags, maturities, budgetRows] =
    await Promise.all([
      sql`
        select * from public.executive_dashboard_snapshot(${startDate}::date, ${endDate}::date)
        order by metric_key`,
      getPendingApprovalsForUser(ctx),
      sql`
        select * from public.restricted_fund_balances
        where ${scoped("entity_id", scope)}
        order by percent_funded asc nulls last, current_balance desc
        limit 8`,
      getComplianceAttention(scope),
      sql`
        select * from public.investment_yield_tracking
        where ${scoped("entity_id", scope)}
          and status = 'active'
          and days_to_maturity between 0 and 30
        order by maturity_date
        limit 8`,
      sql`
        select * from public.budget_vs_actual_rollup
        where ${scoped("entity_id", scope)}
          and entity_type = 'group'
          and fiscal_year = extract(year from ${startDate}::date)::int
        order by variance_amount asc
        limit 8`,
    ]);

  return {
    snapshot: normalizeRows(snapshot),
    pendingApprovals: normalizeRows(pendingApprovals),
    restrictedFunds: normalizeRows(restrictedFunds),
    complianceFlags,
    maturities: normalizeRows(maturities),
    budgetRows: normalizeRows(budgetRows),
  };
}

export function toDelimited(rows: ReportRow[]) {
  if (rows.length === 0) return "No rows\n";
  const columns = Object.keys(rows[0]);
  const header = columns.map(csvCell).join(",");
  const body = rows.map((row) => columns.map((col) => csvCell(row[col])).join(","));
  return [header, ...body].join("\n");
}

export function reportFilename(viewType: string, format: ExportFormat) {
  const ext = format === "excel" ? "csv" : "html";
  return `harvesters-${viewType}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

async function getPendingApprovalsForUser(ctx: AuthContext) {
  const roles = ctx.roles.map((r) => r.role);
  if (roles.length === 0) return [];
  return sql`
    select ra.id, ra.approver_role, ra.sequence_order, ra.is_board_step,
           coalesce(rr.description, 'Batch approval') as description,
           coalesce(rr.amount, rb.total_amount) as amount,
           coalesce(rr.currency, rb.currency) as currency,
           e.name as entity_name
    from public.requisition_approvals ra
    left join public.requisition_requests rr on rr.id = ra.requisition_request_id
    left join public.requisition_batches rb on rb.id = ra.requisition_batch_id
    left join public.entities e on e.id = coalesce(rr.entity_id, rb.entity_id)
    where ra.status = 'pending'
      and ra.approver_role in ${sql(roles)}
      and (${ctx.isSuperAdmin ? sql`true` : ctx.accessibleEntityIds.length === 0 ? sql`false` : sql`coalesce(rr.entity_id, rb.entity_id) in ${sql(ctx.accessibleEntityIds)}`})
    order by ra.notified_at nulls last, ra.sequence_order
    limit 10`;
}

async function getComplianceAttention(scope: Scope) {
  const [nfiu, wht, crossBorder] = await Promise.all([
    sql`
      select 'NFIU large cash' as flag_type, entity_name, amount, currency, transaction_date::text as flag_date
      from public.nfiu_flagged_transactions
      where ${scoped("entity_id", scope)}
      order by transaction_date desc
      limit 5`,
    sql`
      select 'WHT overdue' as flag_type, entity_name, outstanding_amount as amount, 'NGN' as currency, remittance_month::text as flag_date
      from public.wht_remittance_dashboard
      where is_overdue and ${scoped("entity_id", scope)}
      order by remittance_month
      limit 5`,
    sql`
      select 'Cross-border compliance' as flag_type, se.name || ' to ' || re.name as entity_name,
             cbt.amount, cbt.currency, cbt.created_at::date::text as flag_date
      from public.cross_border_transfers cbt
      join public.entities se on se.id = cbt.sending_entity_id
      join public.entities re on re.id = cbt.receiving_entity_id
      where cbt.compliance_status in ('pending_review','flagged')
        and ${scope === "all" ? sql`true` : scope.length === 0 ? sql`false` : sql`(cbt.sending_entity_id in ${sql(scope)} or cbt.receiving_entity_id in ${sql(scope)})`}
      order by cbt.created_at desc
      limit 5`,
  ]);
  return normalizeRows([...nfiu, ...wht, ...crossBorder]);
}

function assertInScope(entityId: string, scope: Scope) {
  if (scope !== "all" && !scope.includes(entityId)) {
    throw new Error("You do not have access to this entity.");
  }
}

function scopeRows(rows: ReportRow[], scope: Scope, key: string) {
  if (scope === "all") return rows;
  return rows.filter((row) => row[key] && scope.includes(String(row[key])));
}

function normalizeRows(rows: readonly Record<string, unknown>[]): ReportRow[] {
  return rows.map((row) => {
    const normalized: ReportRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = normalizeValue(value);
    }
    return normalized;
  });
}

function normalizeValue(value: unknown): ReportRow[string] {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "bigint") return Number(value);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return JSON.stringify(value);
}

function csvCell(value: ReportRow[string]) {
  const raw = value == null ? "" : String(value);
  return `"${raw.replaceAll('"', '""')}"`;
}
