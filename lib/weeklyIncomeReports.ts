import "server-only";
import { sql, type Exec } from "./db";
import type { AuthContext } from "./auth";

type Scope = "all" | string[];
type ReportRow = Record<string, unknown>;

const N = (v: unknown) => Number(v ?? 0);
// NGN-equivalent captured once at write time (0024) — no per-row FX lookups.
const AMT = sql`gr.amount_ngn`;
const scoped = (col: string, scope: Scope) =>
  scope === "all" ? sql`true` : scope.length === 0 ? sql`false` : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export type WeeklyIncomeReport = {
  id: string;
  entityId: string;
  entityName: string;
  weekStart: string;
  weekEnd: string;
  generatedData: Record<string, unknown>;
  aiNarrative: string | null;
  aiAnalysis: string | null;
  sentAt: string | null;
};

export function reportScope(ctx: AuthContext): Scope {
  return ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
}

export function lastCompletedWeek() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - diffToMonday);
  thisMonday.setHours(0, 0, 0, 0);
  const weekStart = new Date(thisMonday);
  weekStart.setDate(thisMonday.getDate() - 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return { weekStart: iso(weekStart), weekEnd: iso(weekEnd) };
}

export async function getCampusesForWeeklyReports(scope: Scope) {
  return sql<{ id: string; name: string; parent_entity_id: string | null }[]>`
    select id, name, parent_entity_id
    from public.entities
    where type = 'campus' and is_active and ${scoped("id", scope)}
    order by name`;
}

export async function getSubgroupsForWeeklyReports(ctx: AuthContext) {
  const scope = reportScope(ctx);
  const canSend = ctx.roles.some((r) =>
    ["sub_group_finance_officer", "group_finance_officer", "cfo_coo", "super_admin"].includes(r.role)
  );
  if (!canSend) return [];
  return sql<{ id: string; name: string; campus_count: number }[]>`
    select sg.id, sg.name, count(c.id)::int as campus_count
    from public.entities sg
    join public.entities c on c.parent_entity_id = sg.id and c.type = 'campus' and c.is_active
    where sg.type = 'sub_group'
      and ${scope === "all" ? sql`true` : scope.length === 0 ? sql`false` : sql`(sg.id in ${sql(scope)} or c.id in ${sql(scope)})`}
    group by sg.id, sg.name
    order by sg.name`;
}

export async function getWeeklyReportInbox(ctx: AuthContext, limit = 8) {
  const scope = reportScope(ctx);
  const rows = await sql`
    select *
    from public.weekly_income_report_inbox
    where ${scope === "all" ? sql`true` : scope.length === 0 ? sql`${ctx.user.id} = any(recipients)` : sql`(entity_id in ${sql(scope)} or ${ctx.user.id} = any(recipients))`}
    order by coalesce(sent_at, created_at) desc
    limit ${limit}`;
  return rows.map(normalizeReport);
}

export async function getWeeklyIncomeReport(id: string, ctx: AuthContext) {
  const scope = reportScope(ctx);
  const [row] = await sql`
    select *
    from public.weekly_income_report_inbox
    where id = ${id}
      and ${scope === "all" ? sql`true` : scope.length === 0 ? sql`${ctx.user.id} = any(recipients)` : sql`(entity_id in ${sql(scope)} or ${ctx.user.id} = any(recipients))`}`;
  return row ? normalizeReport(row) : null;
}

export async function generateWeeklyIncomeReport(d: {
  campusId: string;
  weekStart: string;
  weekEnd: string;
  actorId: string;
  send?: boolean;
}, exec: Exec = sql) {
  const data = await buildReportData(d.campusId, d.weekStart, d.weekEnd);
  const ai = await buildAiNarrative(data);
  const recipients = await getReportRecipients(d.campusId);

  const [row] = await exec`
    insert into public.weekly_income_reports
      (entity_id, week_start, week_end, generated_data, ai_narrative, ai_analysis,
       generated_by, sent_by, sent_at, recipients)
    values
      (${d.campusId}, ${d.weekStart}::date, ${d.weekEnd}::date, ${exec.json(data as never)},
       ${ai.narrative}, ${ai.analysis}, ${d.actorId}, ${d.send ? d.actorId : null},
       ${d.send ? sql`now()` : null}, ${recipients})
    on conflict (entity_id, week_start) do update set
      week_end = excluded.week_end,
      generated_data = excluded.generated_data,
      ai_narrative = excluded.ai_narrative,
      ai_analysis = excluded.ai_analysis,
      generated_by = excluded.generated_by,
      sent_by = excluded.sent_by,
      sent_at = excluded.sent_at,
      recipients = excluded.recipients
    returning id`;
  return String(row.id);
}

export async function sendWeeklyReportsToSubgroup(d: {
  subgroupId: string;
  weekStart: string;
  weekEnd: string;
  actorId: string;
  scope: Scope;
}) {
  const campuses = await sql<{ id: string; name: string }[]>`
    select id, name
    from public.entities
    where type = 'campus' and is_active and parent_entity_id = ${d.subgroupId}
      and ${scoped("id", d.scope)}
    order by name`;
  const generated: string[] = [];
  for (const campus of campuses) {
    generated.push(await generateWeeklyIncomeReport({
      campusId: campus.id,
      weekStart: d.weekStart,
      weekEnd: d.weekEnd,
      actorId: d.actorId,
      send: true,
    }));
  }
  return { count: generated.length, ids: generated };
}

async function buildReportData(campusId: string, weekStart: string, weekEnd: string) {
  const year = Number(weekStart.slice(0, 4));
  const [entity] = await sql`select id, name, functional_currency from public.entities where id = ${campusId}`;
  if (!entity) throw new Error("Campus not found.");

  const monthStart = `${weekStart.slice(0, 7)}-01`;
  const [weekly, monthWeeks, target, ytd, recentReports] = await Promise.all([
    sql`
      select gt.code as giving_type, gr.currency, gr.channel,
             coalesce(sum(gr.amount),0) as amount,
             coalesce(sum(${AMT}),0) as amount_ngn,
             count(*)::int as gift_count,
             count(distinct gr.giver_id)::int as giver_count
      from public.giving_records gr
      join public.giving_types gt on gt.id = gr.giving_type_id
      where gr.entity_id = ${campusId}
        and gr.transaction_date between ${weekStart}::date and ${weekEnd}::date
      group by gt.code, gr.currency, gr.channel
      order by amount_ngn desc`,
    sql`
      select date_trunc('week', gr.transaction_date)::date as week_start,
             (date_trunc('week', gr.transaction_date)::date + 6) as week_end,
             coalesce(sum(${AMT}),0) as amount_ngn,
             count(*)::int as gift_count
      from public.giving_records gr
      where gr.entity_id = ${campusId}
        and gr.transaction_date >= ${monthStart}::date
        and gr.transaction_date <= ${weekEnd}::date
      group by 1,2
      order by 1`,
    sql`
      select coalesce(sum(bl.approved_amount * public.fx_rate_at(e.functional_currency::text, 'NGN', make_date(bc.fiscal_year, 1, 1))),0) as target_ngn
      from public.budget_lines bl
      join public.budget_cycles bc on bc.id = bl.budget_cycle_id
      join public.accounts a on a.id = bl.account_id
      join public.entities e on e.id = bl.entity_id
      where bl.entity_id = ${campusId}
        and bc.fiscal_year = ${year}
        and a.account_type = 'income'`,
    sql`
      select coalesce(sum(${AMT}),0) as achieved_ngn,
             count(*)::int as gift_count
      from public.giving_records gr
      where gr.entity_id = ${campusId}
        and gr.transaction_date between make_date(${year}, 1, 1) and ${weekEnd}::date`,
    sql`
      select week_start::text, generated_data->'totals'->>'weekly_ngn' as weekly_ngn
      from public.weekly_income_reports
      where entity_id = ${campusId} and week_start < ${weekStart}::date
      order by week_start desc
      limit 4`,
  ]);

  const weeklyNgn = weekly.reduce((sum, r) => sum + N(r.amount_ngn), 0);
  const targetNgn = N(target[0]?.target_ngn);
  const achievedNgn = N(ytd[0]?.achieved_ngn);
  const targetToDate = targetNgn * (dayOfYear(new Date(weekEnd)) / daysInYear(year));

  return {
    campus: {
      id: String(entity.id),
      name: String(entity.name),
      currency: String(entity.functional_currency),
    },
    period: { week_start: weekStart, week_end: weekEnd, month_start: monthStart, fiscal_year: year },
    weekly: weekly.map((r) => ({
      giving_type: String(r.giving_type),
      currency: String(r.currency),
      channel: String(r.channel),
      amount: N(r.amount),
      amount_ngn: N(r.amount_ngn),
      gift_count: N(r.gift_count),
      giver_count: N(r.giver_count),
    })),
    month_weeks: monthWeeks.map((r) => ({
      week_start: String(r.week_start),
      week_end: String(r.week_end),
      amount_ngn: N(r.amount_ngn),
      gift_count: N(r.gift_count),
    })),
    target: {
      annual_target_ngn: targetNgn,
      target_to_date_ngn: Math.round(targetToDate),
      achieved_ytd_ngn: achievedNgn,
      achieved_percent: targetNgn > 0 ? round((achievedNgn / targetNgn) * 100) : 0,
      pace_percent: targetToDate > 0 ? round((achievedNgn / targetToDate) * 100) : 0,
    },
    totals: {
      weekly_ngn: weeklyNgn,
      gift_count: weekly.reduce((sum, r) => sum + N(r.gift_count), 0),
      giver_count: weekly.reduce((sum, r) => sum + N(r.giver_count), 0),
    },
    recent_reports: recentReports.map((r) => ({
      week_start: String(r.week_start),
      weekly_ngn: N(r.weekly_ngn),
    })),
  };
}

async function buildAiNarrative(data: Record<string, unknown>) {
  const totals = data.totals as { weekly_ngn: number; gift_count: number; giver_count: number };
  const target = data.target as { achieved_percent: number; pace_percent: number };
  const campus = data.campus as { name: string };
  const fallback = {
    narrative: `${campus.name} recorded ${moneyText(totals.weekly_ngn)} in weekly giving across ${totals.gift_count} gifts from ${totals.giver_count} givers.`,
    analysis: `Year target progress is ${target.achieved_percent}% and pace-to-date is ${target.pace_percent}%. Follow up with ministry leaders on giving participation, pledge redemption, and pastoral care for any sudden slowdown.`,
  };
  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 900,
        temperature: 0.2,
        system: "You write concise church finance weekly income reports. Return JSON only with keys narrative and analysis. Tone: strategic, pastoral-care aware, executive, not alarmist.",
        messages: [{ role: "user", content: JSON.stringify(data) }],
      }),
    });
    if (!response.ok) return fallback;
    const payload = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = payload.content?.find((p) => p.type === "text")?.text;
    if (!text) return fallback;
    const parsed = JSON.parse(stripJsonFence(text)) as { narrative?: string; analysis?: string };
    return { narrative: parsed.narrative || fallback.narrative, analysis: parsed.analysis || fallback.analysis };
  } catch {
    return fallback;
  }
}

async function getReportRecipients(campusId: string) {
  const rows = await sql<{ user_id: string }[]>`
    with recursive ancestors as (
      select id, parent_entity_id from public.entities where id = ${campusId}
      union all
      select e.id, e.parent_entity_id from public.entities e join ancestors a on a.parent_entity_id = e.id
    )
    select distinct uer.user_id
    from public.user_entity_roles uer
    where uer.entity_id in (select id from ancestors)
      and uer.role in ('campus_pastor','campus_admin','campus_finance_officer',
                       'sub_group_pastor','sub_group_finance_officer',
                       'group_pastor','group_finance_officer','cfo_coo','global_lead_pastor')`;
  return rows.map((r) => r.user_id);
}

function normalizeReport(row: ReportRow): WeeklyIncomeReport {
  return {
    id: String(row.id),
    entityId: String(row.entity_id),
    entityName: String(row.entity_name),
    weekStart: String(row.week_start),
    weekEnd: String(row.week_end),
    generatedData: typeof row.generated_data === "string" ? JSON.parse(row.generated_data) : (row.generated_data as Record<string, unknown>),
    aiNarrative: row.ai_narrative ? String(row.ai_narrative) : null,
    aiAnalysis: row.ai_analysis ? String(row.ai_analysis) : null,
    sentAt: row.sent_at ? String(row.sent_at) : null,
  };
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function dayOfYear(d: Date) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}
function daysInYear(y: number) {
  return new Date(y, 1, 29).getMonth() === 1 ? 366 : 365;
}
function round(v: number) {
  return Math.round(v * 100) / 100;
}
function moneyText(v: number) {
  return `NGN ${Math.round(v).toLocaleString("en-NG")}`;
}
function stripJsonFence(text: string) {
  return text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
}
