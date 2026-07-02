import "server-only";
import { sql } from "./db";

export type Scope = "all" | string[];
const N = (v: unknown) => Number(v ?? 0);
const scoped = (col: string, scope: Scope) =>
  scope === "all" ? sql`true` : scope.length === 0 ? sql`false` : sql`${sql.unsafe(col)} in ${sql(scope)}`;

// NGN-equivalent of a giving_records row.
const AMT = sql`round(gr.amount * public.fx_rate_at(gr.currency::text, 'NGN', gr.transaction_date), 2)`;

// ---------------------------------------------------------------------------
// Weekly giving — consolidated NGN + per-currency breakdown (last 7 days).
// ---------------------------------------------------------------------------
export async function getWeeklyGiving(scope: Scope) {
  const rows = await sql`
    select gr.currency,
           sum(gr.amount) as raw,
           sum(${AMT}) as ngn,
           count(*)::int as gifts
    from public.giving_records gr
    where gr.transaction_date >= current_date - interval '7 days'
      and ${scoped("gr.entity_id", scope)}
    group by gr.currency order by ngn desc`;
  const byCurrency = rows.map((r) => ({ currency: String(r.currency), raw: N(r.raw), ngn: N(r.ngn), gifts: N(r.gifts) }));
  return { totalNgn: byCurrency.reduce((s, r) => s + r.ngn, 0), byCurrency };
}

export async function getYearGivingTotalNgn(scope: Scope) {
  const [r] = await sql`
    select coalesce(sum(${AMT}),0) ngn, count(*)::int gifts
    from public.giving_records gr
    where extract(year from gr.transaction_date)=extract(year from current_date) and ${scoped("gr.entity_id", scope)}`;
  return { ngn: N(r.ngn), gifts: N(r.gifts) };
}

// ---------------------------------------------------------------------------
// Giving breakdown tree: group -> sub-group -> campus (+ ministries), each with
// characteristic totals (Sunday/midweek offering, tithe, seed, partnership,
// redeemed pledges, other) and channel mix. YTD, NGN-equivalent.
// ---------------------------------------------------------------------------
export type GivingMetrics = {
  sunday: number; midweek: number; tithe: number; seed: number; partnership: number; redeemed: number; other: number;
  bank_transfer: number; pos: number; cash: number; online: number; total: number;
};
export type GNode = { id: string; name: string; type: string; metrics: GivingMetrics; children: GNode[] };

const zero = (): GivingMetrics => ({ sunday: 0, midweek: 0, tithe: 0, seed: 0, partnership: 0, redeemed: 0, other: 0, bank_transfer: 0, pos: 0, cash: 0, online: 0, total: 0 });
const add = (a: GivingMetrics, b: GivingMetrics) => { (Object.keys(a) as (keyof GivingMetrics)[]).forEach((k) => (a[k] += b[k])); return a; };

export async function getGivingBreakdown(scope: Scope): Promise<{ groups: GNode[]; ministries: GNode[] }> {
  const [ents, rows, redeemed] = await Promise.all([
    sql<{ id: string; name: string; type: string; parent_entity_id: string | null; is_active: boolean }[]>`
      select id, name, type, parent_entity_id, is_active from public.entities`,
    sql`
      select gr.entity_id,
        coalesce(sum(${AMT}) filter (where gt.code='offering' and extract(dow from gr.transaction_date)=0),0) sunday,
        coalesce(sum(${AMT}) filter (where gt.code='offering' and extract(dow from gr.transaction_date)<>0),0) midweek,
        coalesce(sum(${AMT}) filter (where gt.code='tithe'),0) tithe,
        coalesce(sum(${AMT}) filter (where gt.code in ('seed','first_fruit')),0) seed,
        coalesce(sum(${AMT}) filter (where gt.code='partnership'),0) partnership,
        coalesce(sum(${AMT}) filter (where gt.code in ('building_fund','missions_pledge','vow','event_offering')),0) other,
        coalesce(sum(${AMT}) filter (where gr.channel='bank_transfer'),0) bank_transfer,
        coalesce(sum(${AMT}) filter (where gr.channel='pos'),0) pos,
        coalesce(sum(${AMT}) filter (where gr.channel='cash'),0) cash,
        coalesce(sum(${AMT}) filter (where gr.channel in ('online_paystack','ussd','standing_order')),0) online,
        coalesce(sum(${AMT}),0) total
      from public.giving_records gr join public.giving_types gt on gt.id=gr.giving_type_id
      where extract(year from gr.transaction_date)=extract(year from current_date) and ${scoped("gr.entity_id", scope)}
      group by gr.entity_id`,
    sql`
      select p.entity_id, coalesce(sum(round(pf.amount * public.fx_rate_at(p.currency::text,'NGN',pf.created_at::date),2)),0) redeemed
      from public.pledge_fulfillments pf join public.pledges p on p.id=pf.pledge_id
      where ${scoped("p.entity_id", scope)} group by p.entity_id`,
  ]);

  const leaf = new Map<string, GivingMetrics>();
  for (const r of rows) {
    leaf.set(String(r.entity_id), {
      sunday: N(r.sunday), midweek: N(r.midweek), tithe: N(r.tithe), seed: N(r.seed), partnership: N(r.partnership),
      other: N(r.other), redeemed: 0, bank_transfer: N(r.bank_transfer), pos: N(r.pos), cash: N(r.cash), online: N(r.online), total: N(r.total),
    });
  }
  for (const r of redeemed) {
    const m = leaf.get(String(r.entity_id)) ?? zero();
    m.redeemed += N(r.redeemed); m.total += N(r.redeemed);
    leaf.set(String(r.entity_id), m);
  }

  const childrenOf = (pid: string) => ents.filter((e) => e.parent_entity_id === pid && e.is_active);
  const root = ents.find((e) => e.name === "Harvesters International Christian Centre" && e.type === "group");

  const buildNode = (e: { id: string; name: string; type: string }): GNode => {
    const kids = childrenOf(e.id).filter((c) => c.type !== "event").map(buildNode);
    const metrics = leaf.get(e.id) ?? zero();
    const agg = zero();
    add(agg, metrics);
    for (const k of kids) add(agg, k.metrics);
    return { id: e.id, name: e.name, type: e.type, metrics: agg, children: kids };
  };

  const groups = root ? childrenOf(root.id).filter((e) => e.type === "group").map(buildNode) : [];
  const ministries = root ? childrenOf(root.id).filter((e) => e.type === "ministry_directorate" || e.type === "ministry_expression").map(buildNode) : [];
  return { groups, ministries };
}

// ---------------------------------------------------------------------------
// Entity analytics: MoM (12mo), Week-on-Week (12wk), YoY (this vs last year).
// Includes the entity + all descendants.
// ---------------------------------------------------------------------------
export async function getEntityGivingAnalytics(entityId: string) {
  const D = sql`(with recursive d as (select ${entityId}::uuid id union all select e.id from public.entities e join d on e.parent_entity_id=d.id) select id from d)`;
  const [entity, mom, wow, yoy, channels, types] = await Promise.all([
    sql`select id, name, type from public.entities where id=${entityId}`,
    sql`select to_char(date_trunc('month', gr.transaction_date),'Mon') label, date_trunc('month', gr.transaction_date) ord, sum(${AMT}) amount
        from public.giving_records gr where gr.entity_id in ${D} and gr.transaction_date >= date_trunc('month',current_date)-interval '11 months'
        group by 1,2 order by 2`,
    sql`select 'W'||to_char(date_trunc('week', gr.transaction_date),'IW') label, date_trunc('week', gr.transaction_date) ord, sum(${AMT}) amount
        from public.giving_records gr where gr.entity_id in ${D} and gr.transaction_date >= date_trunc('week',current_date)-interval '11 weeks'
        group by 1,2 order by 2`,
    sql`select extract(month from gr.transaction_date)::int m, to_char(gr.transaction_date,'Mon') label,
          coalesce(sum(${AMT}) filter (where extract(year from gr.transaction_date)=extract(year from current_date)),0) this_year,
          coalesce(sum(${AMT}) filter (where extract(year from gr.transaction_date)=extract(year from current_date)-1),0) last_year
        from public.giving_records gr
        where gr.entity_id in ${D} and extract(year from gr.transaction_date) in (extract(year from current_date), extract(year from current_date)-1)
        group by 1,2 order by 1`,
    sql`select gr.channel, sum(${AMT}) amount from public.giving_records gr where gr.entity_id in ${D}
          and extract(year from gr.transaction_date)=extract(year from current_date) group by gr.channel order by amount desc`,
    sql`select gt.name, sum(${AMT}) amount from public.giving_records gr join public.giving_types gt on gt.id=gr.giving_type_id
          where gr.entity_id in ${D} and extract(year from gr.transaction_date)=extract(year from current_date) group by gt.name order by amount desc`,
  ]);
  return {
    entity: entity[0] ? { id: String(entity[0].id), name: String(entity[0].name), type: String(entity[0].type) } : null,
    mom: mom.map((r) => ({ label: String(r.label), amount: N(r.amount) })),
    wow: wow.map((r) => ({ label: String(r.label), amount: N(r.amount) })),
    yoy: yoy.map((r) => ({ label: String(r.label), thisYear: N(r.this_year), lastYear: N(r.last_year) })),
    channels: channels.map((r) => ({ name: String(r.channel), amount: N(r.amount) })),
    types: types.map((r) => ({ name: String(r.name), amount: N(r.amount) })),
  };
}

// ---------------------------------------------------------------------------
// NLP inflow: daily (30d) + weekly (12wk), since NLP giving comes in daily.
// ---------------------------------------------------------------------------
export async function getNlpInflow() {
  const [nlp] = await sql`select id from public.entities where name='Next Level Prayers' limit 1`;
  if (!nlp) return null;
  const D = sql`(with recursive d as (select ${nlp.id}::uuid id union all select e.id from public.entities e join d on e.parent_entity_id=d.id) select id from d)`;
  const [daily, weekly] = await Promise.all([
    sql`select to_char(gr.transaction_date,'DD Mon') label, gr.transaction_date ord, sum(${AMT}) amount
        from public.giving_records gr where gr.entity_id in ${D} and gr.transaction_date >= current_date - interval '29 days'
        group by 1,2 order by 2`,
    sql`select 'W'||to_char(date_trunc('week', gr.transaction_date),'IW') label, date_trunc('week', gr.transaction_date) ord, sum(${AMT}) amount
        from public.giving_records gr where gr.entity_id in ${D} and gr.transaction_date >= date_trunc('week',current_date)-interval '11 weeks'
        group by 1,2 order by 2`,
  ]);
  return {
    entityId: String(nlp.id),
    daily: daily.map((r) => ({ label: String(r.label), amount: N(r.amount) })),
    weekly: weekly.map((r) => ({ label: String(r.label), amount: N(r.amount) })),
  };
}
