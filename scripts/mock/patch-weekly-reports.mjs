// Pre-seed weekly income reports for the demo (Gbagada + UK subgroups), so the
// dashboard inbox and /reports/weekly are populated before anyone clicks Send.
// Ports lib/weeklyIncomeReports.buildReportData faithfully. Idempotent (upsert);
// reversible via reset. Usage: node --env-file=.env.local scripts/mock/patch-weekly-reports.mjs
import { sql } from "./lib.mjs";

const N = (v) => Number(v ?? 0);
const AMT = sql`round(gr.amount * public.fx_rate_at(gr.currency::text, 'NGN', gr.transaction_date), 2)`;
const iso = (d) => d.toISOString().slice(0, 10);

function lastCompletedWeek() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - diffToMonday);
  const weekStart = new Date(thisMonday);
  weekStart.setDate(thisMonday.getDate() - 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return { weekStart: iso(weekStart), weekEnd: iso(weekEnd) };
}
const dayOfYear = (d) => Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000);
const daysInYear = (y) => (new Date(y, 1, 29).getMonth() === 1 ? 366 : 365);
const round = (v) => Math.round(v * 100) / 100;

async function buildReportData(campusId, weekStart, weekEnd) {
  const year = Number(weekStart.slice(0, 4));
  const [entity] = await sql`select id, name, functional_currency from public.entities where id = ${campusId}`;
  const monthStart = `${weekStart.slice(0, 7)}-01`;
  const [weekly, monthWeeks, target, ytd] = await Promise.all([
    sql`select gt.code as giving_type, gr.currency, gr.channel,
          coalesce(sum(gr.amount),0) as amount, coalesce(sum(${AMT}),0) as amount_ngn,
          count(*)::int as gift_count, count(distinct gr.giver_id)::int as giver_count
        from public.giving_records gr join public.giving_types gt on gt.id = gr.giving_type_id
        where gr.entity_id = ${campusId} and gr.transaction_date between ${weekStart}::date and ${weekEnd}::date
        group by gt.code, gr.currency, gr.channel order by amount_ngn desc`,
    sql`select date_trunc('week', gr.transaction_date)::date as week_start,
          (date_trunc('week', gr.transaction_date)::date + 6) as week_end,
          coalesce(sum(${AMT}),0) as amount_ngn, count(*)::int as gift_count
        from public.giving_records gr
        where gr.entity_id = ${campusId} and gr.transaction_date >= ${monthStart}::date and gr.transaction_date <= ${weekEnd}::date
        group by 1,2 order by 1`,
    sql`select coalesce(sum(bl.approved_amount * public.fx_rate_at(e.functional_currency::text, 'NGN', make_date(bc.fiscal_year, 1, 1))),0) as target_ngn
        from public.budget_lines bl
        join public.budget_cycles bc on bc.id = bl.budget_cycle_id
        join public.accounts a on a.id = bl.account_id
        join public.entities e on e.id = bl.entity_id
        where bl.entity_id = ${campusId} and bc.fiscal_year = ${year} and a.account_type = 'income'`,
    sql`select coalesce(sum(${AMT}),0) as achieved_ngn, count(*)::int as gift_count
        from public.giving_records gr
        where gr.entity_id = ${campusId} and gr.transaction_date between make_date(${year}, 1, 1) and ${weekEnd}::date`,
  ]);

  const weeklyNgn = weekly.reduce((s, r) => s + N(r.amount_ngn), 0);
  const targetNgn = N(target[0]?.target_ngn);
  const achievedNgn = N(ytd[0]?.achieved_ngn);
  const targetToDate = targetNgn * (dayOfYear(new Date(weekEnd)) / daysInYear(year));

  return {
    campus: { id: String(entity.id), name: String(entity.name), currency: String(entity.functional_currency) },
    period: { week_start: weekStart, week_end: weekEnd, month_start: monthStart, fiscal_year: year },
    weekly: weekly.map((r) => ({ giving_type: String(r.giving_type), currency: String(r.currency), channel: String(r.channel),
      amount: N(r.amount), amount_ngn: N(r.amount_ngn), gift_count: N(r.gift_count), giver_count: N(r.giver_count) })),
    month_weeks: monthWeeks.map((r) => ({ week_start: String(r.week_start), week_end: String(r.week_end), amount_ngn: N(r.amount_ngn), gift_count: N(r.gift_count) })),
    target: {
      annual_target_ngn: targetNgn,
      target_to_date_ngn: Math.round(targetToDate),
      achieved_ytd_ngn: achievedNgn,
      achieved_percent: targetNgn > 0 ? round((achievedNgn / targetNgn) * 100) : 0,
      pace_percent: targetToDate > 0 ? round((achievedNgn / targetToDate) * 100) : 0,
    },
    totals: {
      weekly_ngn: weeklyNgn,
      gift_count: weekly.reduce((s, r) => s + N(r.gift_count), 0),
      giver_count: weekly.reduce((s, r) => s + N(r.giver_count), 0),
    },
    recent_reports: [],
  };
}

try {
  const [{ id: officer }] = await sql`select id from auth.users where email like 'grp2sub1accountant%' or email='cfo@harvestersng.org' order by email limit 1`;
  const { weekStart, weekEnd } = lastCompletedWeek();
  const subs = await sql`select id, name from public.entities where type='sub_group' and is_active and name in ('Gbagada Subgroup','UK Subgroup')`;
  let count = 0;
  for (const sg of subs) {
    const campuses = await sql`select id, name from public.entities where parent_entity_id=${sg.id} and type='campus' and is_active order by name`;
    for (const c of campuses) {
      const data = await buildReportData(c.id, weekStart, weekEnd);
      const narrative = `${c.name} recorded NGN ${Math.round(data.totals.weekly_ngn).toLocaleString("en-NG")} in weekly giving across ${data.totals.gift_count} gifts from ${data.totals.giver_count} givers.`;
      const analysis = `Year target progress is ${data.target.achieved_percent}% and pace-to-date is ${data.target.pace_percent}%. Follow up with ministry leaders on giving participation, pledge redemption, and pastoral care for any sudden slowdown.`;
      const recipients = (await sql`
        with recursive ancestors as (
          select id, parent_entity_id from public.entities where id = ${c.id}
          union all select e.id, e.parent_entity_id from public.entities e join ancestors a on a.parent_entity_id = e.id)
        select distinct uer.user_id from public.user_entity_roles uer
        where uer.entity_id in (select id from ancestors)
          and uer.role in ('campus_pastor','campus_admin','campus_finance_officer','sub_group_pastor','sub_group_finance_officer','group_pastor','group_finance_officer','cfo_coo','global_lead_pastor')`).map((r) => r.user_id);
      await sql`insert into public.weekly_income_reports
          (entity_id, week_start, week_end, generated_data, ai_narrative, ai_analysis, generated_by, sent_by, sent_at, recipients)
        values (${c.id}, ${weekStart}::date, ${weekEnd}::date, ${sql.json(data)}, ${narrative}, ${analysis}, ${officer}, ${officer}, now(), ${recipients})
        on conflict (entity_id, week_start) do update set
          generated_data = excluded.generated_data, ai_narrative = excluded.ai_narrative,
          ai_analysis = excluded.ai_analysis, sent_by = excluded.sent_by, sent_at = now(), recipients = excluded.recipients`;
      await sql`insert into public.notifications (user_id, role, entity_id, title, body, href)
        values (null, 'campus_pastor'::public.app_role, ${c.id}, ${'Weekly income report — ' + c.name},
          ${'Week ' + weekStart + ' to ' + weekEnd + ': NGN ' + Math.round(data.totals.weekly_ngn).toLocaleString('en-NG') + ' received.'}, '/reports/weekly')`;
      count++;
    }
  }
  console.log(`✅ Pre-seeded ${count} weekly income reports (week ${weekStart} – ${weekEnd}).`);
} catch (e) {
  console.error("❌", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
