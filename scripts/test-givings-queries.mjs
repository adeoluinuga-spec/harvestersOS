// Executes the givings read queries (as written in lib/givings.ts) against the
// real schema to catch column/typo errors that only surface at runtime.
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });
let fail = 0;
const run = async (label, fn) => {
  try { await fn(); console.log(`  ✅ ${label}`); }
  catch (e) { fail++; console.log(`  ❌ ${label}: ${e.message.split("\n")[0]}`); }
};

try {
  console.log("\n── Read queries execute cleanly ──");
  await run("getGivingTypes", () => sql`select id, code, name, default_fund_classification from public.giving_types where is_active order by sort_order, name`);
  await run("searchGivers('')", () => sql`select id, full_name, phone, email, primary_entity_id, is_active from public.givers where is_active and ('' = '' or full_name ilike '%%') order by full_name limit 50`);
  await run("getRecentGivings(all)", () => sql`
    select gr.id, gr.transaction_date, coalesce(gv.full_name,'Anonymous') giver, gt.name type, e.name entity, gr.amount, gr.currency, gr.channel
    from public.giving_records gr left join public.givers gv on gv.id=gr.giver_id
    join public.giving_types gt on gt.id=gr.giving_type_id join public.entities e on e.id=gr.entity_id
    where true order by gr.created_at desc limit 25`);
  await run("getGivingSummary totals", () => sql`
    select gr.currency, sum(gr.amount) total, count(*)::int n from public.giving_records gr
    where true and date_trunc('year', gr.transaction_date)=date_trunc('year', current_date) group by gr.currency`);
  await run("getMergeQueue", () => sql`
    select mc.id, mc.score, mc.reason, mc.detected_at, a.id a_id, a.full_name a_name, a.phone a_phone, a.email a_email,
      b.id b_id, b.full_name b_name, b.phone b_phone, b.email b_email,
      (select count(*)::int from public.giving_records where giver_id=a.id) a_gifts,
      (select count(*)::int from public.giving_records where giver_id=b.id) b_gifts
    from public.giver_merge_candidates mc join public.givers a on a.id=mc.giver_id_a join public.givers b on b.id=mc.giver_id_b
    where mc.status='pending' order by mc.score desc, mc.detected_at desc`);
  await run("getPledgeAging(all)", () => sql`
    select pa.pledge_id, pa.entity_id, pa.entity_name, pa.giver_name, pa.pledge_type, pa.currency,
      pa.total_pledged_amount, pa.fulfilled_amount, pa.outstanding_amount, pa.target_fulfillment_date, pa.status, pa.aging_bucket
    from public.pledge_aging pa where true
    order by case pa.aging_bucket when '90+' then 0 when '61-90' then 1 when '31-60' then 2 when '1-30' then 3
      when 'current' then 4 when 'no_due_date' then 5 else 6 end, pa.outstanding_amount desc`);
  await run("pledge_balances view", () => sql`select * from public.pledge_balances limit 1`);

  // Giver-specific queries need a giver — create one in a rolled-back tx.
  await run("getGiver/history/totals/statement (with fixture)", async () => {
    await sql.begin(async (tx) => {
      const [{ id: gb }] = await tx`select id from public.entities where name='Gbagada Campus'`;
      const [g] = await tx`insert into public.givers (full_name, primary_entity_id) values ('QueryTest', ${gb}) returning id`;
      await tx`select id, full_name, phone, email, primary_entity_id, is_active from public.givers where id=${g.id}`;
      await tx`select gr.id, gr.transaction_date, gt.name type_name, e.name entity_name, gr.amount, gr.currency, gr.channel, gr.reconciliation_status
        from public.giving_records gr join public.giving_types gt on gt.id=gr.giving_type_id join public.entities e on e.id=gr.entity_id
        where gr.giver_id=${g.id} order by gr.transaction_date desc, gr.created_at desc`;
      await tx`select gt.name, gr.currency, sum(gr.amount) total from public.giving_records gr join public.giving_types gt on gt.id=gr.giving_type_id
        where gr.giver_id=${g.id} group by gt.name, gr.currency order by total desc`;
      await tx`select gr.transaction_date, gt.name type_name, e.name entity_name, gr.channel, gr.amount, gr.currency
        from public.giving_records gr join public.giving_types gt on gt.id=gr.giving_type_id join public.entities e on e.id=gr.entity_id
        where gr.giver_id=${g.id} and extract(year from gr.transaction_date)=2026 order by gr.transaction_date`;
      throw new Error("__rollback__");
    }).catch((e) => { if (e.message !== "__rollback__") throw e; });
  });

  console.log(`\n${fail === 0 ? "✅ ALL QUERIES OK" : "❌ QUERY ERRORS"} — ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  await sql.end();
}
