import "server-only";
import { sql } from "./db";
import type { AuthContext } from "./auth";

// The executive dashboard renders for super_admin/CFO only, so data is global.
const ROOT = sql`(select id from public.entities where name='Harvesters International Christian Centre' and type='group' order by created_at limit 1)`;
const N = (v: unknown) => Number(v ?? 0);

export type Severity = "attention" | "healthy";
export type Kpi = {
  key: string;
  label: string;
  value: number;
  currency: string;
  format: "money" | "count";
  status: Severity;
  href: string;
  caption: string;
};
export type NamedAmount = { name: string; amount: number; extra?: string };

export async function getExecutiveData(_ctx: AuthContext) {
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const today = new Date().toISOString().slice(0, 10);

  const [
    snapshot, givingByGroup, givingTrend, incomeExpense, budgetByGroup,
    fundProgress, approvalsMine, approvalsAll, approvalsByRole, compliance, maturities,
  ] = await Promise.all([
    sql`select metric_key, metric_value, severity, currency from public.executive_dashboard_snapshot(${yearStart}::date, ${today}::date)`,

    // Giving by group — same basis as the consolidated_giving KPI (giving_records × fx_rate_at, YTD).
    sql`with recursive tree as (
        select g.id root, g.name grp, g.id eid from public.entities g where g.type='group' and g.is_active and g.parent_entity_id=${ROOT}
        union all select t.root, t.grp, e.id from public.entities e join tree t on e.parent_entity_id=t.eid)
      select t.grp name, coalesce(sum(case when gr.id is not null then round(gr.amount * public.fx_rate_at(gr.currency::text,'NGN',gr.transaction_date),2) else 0 end),0) amount
      from tree t
      left join public.giving_records gr on gr.entity_id=t.eid and gr.transaction_date between ${yearStart} and ${today}
      group by t.grp order by amount desc`,

    sql`select to_char(date_trunc('month', gr.transaction_date),'Mon') label, date_trunc('month', gr.transaction_date) ord,
        coalesce(sum(round(gr.amount * public.fx_rate_at(gr.currency::text,'NGN',gr.transaction_date),2)),0) amount
      from public.giving_records gr
      where gr.transaction_date >= (date_trunc('month',current_date)-interval '11 months')
      group by 1,2 order by 2`,

    sql`select to_char(date_trunc('month', e.transaction_date),'Mon') label, date_trunc('month', e.transaction_date) ord,
        coalesce(sum(case when a.account_type='income' then l.credit_amount*l.fx_rate_to_presentation_currency else 0 end),0) income,
        coalesce(sum(case when a.account_type='expense' then l.debit_amount*l.fx_rate_to_presentation_currency else 0 end),0) expense
      from public.journal_entries e join public.journal_entry_lines l on l.journal_entry_id=e.id join public.accounts a on a.id=l.account_id
      where e.status='posted' and e.transaction_date >= (date_trunc('month',current_date)-interval '11 months')
      group by 1,2 order by 2`,

    sql`select entity_id, entity_name, sum(approved_amount) approved, sum(actual_amount) actual, sum(variance_amount) variance
      from public.budget_vs_actual_rollup where entity_type='group' and parent_entity_id is not null and fiscal_year=extract(year from current_date)::int
      group by entity_id, entity_name order by entity_name`,

    sql`select id, name, entity_name, current_balance, target_amount, percent_funded
      from public.restricted_fund_balances order by percent_funded desc nulls last limit 10`,

    getPendingApprovalsForUser(_ctx),

    sql`select ra.id, ra.approver_role, ra.is_board_step, coalesce(rr.description,'Batch approval') description,
        coalesce(rr.amount, rb.total_amount) amount, coalesce(rr.currency, rb.currency, 'NGN') currency, e.name entity_name
      from public.requisition_approvals ra
      left join public.requisition_requests rr on rr.id=ra.requisition_request_id
      left join public.requisition_batches rb on rb.id=ra.requisition_batch_id
      left join public.entities e on e.id=coalesce(rr.entity_id, rb.entity_id)
      where ra.status='pending' order by ra.sequence_order limit 25`,

    sql`select ra.approver_role name, count(*)::int cnt,
        coalesce(sum(coalesce(rr.amount, rb.total_amount)),0) amount
      from public.requisition_approvals ra
      left join public.requisition_requests rr on rr.id=ra.requisition_request_id
      left join public.requisition_batches rb on rb.id=ra.requisition_batch_id
      where ra.status='pending' group by ra.approver_role order by cnt desc`,

    getCompliance(),

    sql`select id, entity_name, investment_type, institution, principal_amount, currency, maturity_date::text, days_to_maturity
      from public.investment_yield_tracking where status='active' and days_to_maturity between 0 and 45
      order by maturity_date limit 10`,
  ]);

  const snap = (k: string) => snapshot.find((m) => m.metric_key === k);
  const sev = (k: string): Severity => (snap(k)?.severity === "attention" ? "attention" : "healthy");

  const kpis: Kpi[] = [
    { key: "consolidated_giving", label: "Consolidated giving (YTD)", value: N(snap("consolidated_giving")?.metric_value), currency: "NGN", format: "money", status: "healthy", href: "/givings", caption: "Total income posted this year, all entities, converted to NGN." },
    { key: "budget_variance", label: "Budget variance", value: N(snap("budget_variance")?.metric_value), currency: "NGN", format: "money", status: sev("budget_variance"), href: "/budgeting", caption: "Approved budget vs actuals across groups." },
    { key: "restricted_fund_balances", label: "Restricted funds", value: N(snap("restricted_fund_balances")?.metric_value), currency: "NGN", format: "money", status: "healthy", href: "/funds", caption: "Balances held in restricted/designated funds." },
    { key: "pending_approvals", label: "Pending approvals (org-wide)", value: N(snap("pending_approvals")?.metric_value), currency: "NGN", format: "count", status: sev("pending_approvals"), href: "/expenses/approvals", caption: "Every approval awaiting action across the org. Routed to pastors and the board — not to super-admins." },
    { key: "compliance_flags", label: "Compliance attention", value: N(snap("compliance_flags")?.metric_value), currency: "NGN", format: "count", status: sev("compliance_flags"), href: "/governance", caption: "NFIU large-cash, overdue WHT, and cross-border items needing review." },
    { key: "investment_maturities", label: "Maturing ≤45 days", value: maturities.length, currency: "NGN", format: "count", status: maturities.length > 0 ? "attention" : "healthy", href: "/funds/investments", caption: "Investments maturing soon that need a rollover/redemption decision." },
  ];

  return {
    kpis,
    charts: {
      givingByGroup: givingByGroup.map((r) => ({ name: String(r.name), amount: N(r.amount) })),
      givingTrend: givingTrend.map((r) => ({ label: String(r.label), amount: N(r.amount) })),
      incomeExpense: incomeExpense.map((r) => ({ label: String(r.label), income: N(r.income), expense: N(r.expense) })),
      fundProgress: fundProgress.map((r) => ({ name: String(r.entity_name), percent: N(r.percent_funded), balance: N(r.current_balance), target: N(r.target_amount) })),
    },
    budgetByGroup: budgetByGroup.map((r) => ({
      entityId: String(r.entity_id), name: String(r.entity_name),
      approved: N(r.approved), actual: N(r.actual), variance: N(r.variance),
      ratio: N(r.approved) > 0 ? N(r.actual) / N(r.approved) : 0,
    })),
    fundProgress: fundProgress.map((r) => ({ id: String(r.id), name: String(r.name), entity: String(r.entity_name), balance: N(r.current_balance), target: N(r.target_amount), percent: N(r.percent_funded) })),
    approvals: {
      mine: approvalsMine.map(normApproval),
      all: approvalsAll.map(normApproval),
      byRole: approvalsByRole.map((r) => ({ name: String(r.name), cnt: N(r.cnt), amount: N(r.amount) })),
    },
    compliance,
    maturities: maturities.map((r) => ({
      id: String(r.id), institution: String(r.institution), entity: String(r.entity_name),
      type: String(r.investment_type), amount: N(r.principal_amount), currency: String(r.currency ?? "NGN"),
      maturityDate: String(r.maturity_date), days: N(r.days_to_maturity),
    })),
  };
}

type ApprovalRow = Record<string, unknown>;
function normApproval(r: ApprovalRow) {
  return {
    id: String(r.id), role: String(r.approver_role), board: Boolean(r.is_board_step),
    description: String(r.description), entity: String(r.entity_name ?? "—"),
    amount: N(r.amount), currency: String(r.currency ?? "NGN"),
  };
}

async function getPendingApprovalsForUser(ctx: AuthContext): Promise<ApprovalRow[]> {
  const roles = ctx.roles.map((r) => r.role);
  if (roles.length === 0) return [];
  return sql`
    select ra.id, ra.approver_role, ra.is_board_step, coalesce(rr.description,'Batch approval') description,
      coalesce(rr.amount, rb.total_amount) amount, coalesce(rr.currency, rb.currency, 'NGN') currency, e.name entity_name
    from public.requisition_approvals ra
    left join public.requisition_requests rr on rr.id=ra.requisition_request_id
    left join public.requisition_batches rb on rb.id=ra.requisition_batch_id
    left join public.entities e on e.id=coalesce(rr.entity_id, rb.entity_id)
    where ra.status='pending' and ra.approver_role in ${sql(roles)}
    order by ra.sequence_order limit 25`;
}

export type PortfolioInvestment = {
  id: string; group: string; subgroup: string | null; entity: string; type: string;
  institution: string; principal: number; currency: string; rate: number;
  start: string; maturity: string; status: string; days: number;
  expected: number; actual: number; variance: number;
};

/** Every investment annotated with its group + sub-group, for the portfolio view. */
export async function getInvestmentPortfolio(): Promise<PortfolioInvestment[]> {
  const [invs, ents, rootRow] = await Promise.all([
    sql`select * from public.investment_yield_tracking order by maturity_date`,
    sql<{ id: string; name: string; type: string; parent_entity_id: string | null }[]>`
      select id, name, type, parent_entity_id from public.entities`,
    sql<{ id: string }[]>`select id from public.entities where name='Harvesters International Christian Centre' and type='group' order by created_at limit 1`,
  ]);
  const byId = new Map(ents.map((e) => [e.id, e]));
  const rootId = rootRow[0]?.id;

  type Ent = { id: string; name: string; type: string; parent_entity_id: string | null };
  const ancestry = (entityId: string): { group: string; subgroup: string | null } => {
    const chain: Ent[] = [];
    let cur = byId.get(entityId) as Ent | undefined;
    while (cur) { chain.push(cur); cur = cur.parent_entity_id ? byId.get(cur.parent_entity_id) : undefined; }
    const topGroup = chain.find((n) => n.type === "group" && n.parent_entity_id === rootId);
    const subgroup = chain.find((n) => n.type === "sub_group");
    return { group: topGroup?.name ?? chain.find((n) => n.type === "group")?.name ?? "—", subgroup: subgroup?.name ?? null };
  };

  return invs.map((i) => {
    const a = ancestry(String(i.entity_id));
    return {
      id: String(i.id), group: a.group, subgroup: a.subgroup, entity: String(i.entity_name),
      type: String(i.investment_type), institution: String(i.institution), principal: N(i.principal_amount),
      currency: String(i.currency ?? "NGN"), rate: N(i.interest_rate), start: String(i.start_date),
      maturity: String(i.maturity_date), status: String(i.status), days: N(i.days_to_maturity),
      expected: N(i.expected_return_amount), actual: N(i.actual_return_amount), variance: N(i.return_variance_amount),
    };
  });
}

export type ComplianceItem = { type: string; entity: string; amount: number; currency: string; date: string; severity: "high" | "medium" };
async function getCompliance(): Promise<ComplianceItem[]> {
  const [nfiu, wht, cross] = await Promise.all([
    sql`select entity_name, amount, currency, transaction_date::text d from public.nfiu_flagged_transactions order by transaction_date desc limit 6`,
    sql`select entity_name, outstanding_amount amount, remittance_month::text d from public.wht_remittance_dashboard where is_overdue order by remittance_month limit 6`,
    sql`select se.name||' → '||re.name entity_name, cbt.amount, cbt.currency, cbt.created_at::date::text d
      from public.cross_border_transfers cbt join public.entities se on se.id=cbt.sending_entity_id join public.entities re on re.id=cbt.receiving_entity_id
      where cbt.compliance_status in ('pending_review','flagged') order by cbt.created_at desc limit 6`,
  ]);
  return [
    ...nfiu.map((r) => ({ type: "NFIU large cash", entity: String(r.entity_name), amount: N(r.amount), currency: String(r.currency ?? "NGN"), date: String(r.d), severity: "high" as const })),
    ...wht.map((r) => ({ type: "WHT overdue", entity: String(r.entity_name), amount: N(r.amount), currency: "NGN", date: String(r.d), severity: "high" as const })),
    ...cross.map((r) => ({ type: "Cross-border review", entity: String(r.entity_name), amount: N(r.amount), currency: String(r.currency ?? "NGN"), date: String(r.d), severity: "medium" as const })),
  ];
}
