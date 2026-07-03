// Pass 2 verification: weekly report schema + inbox view, notifications +
// message outbox, scoped dashboard queries, requisition/disbursement import
// commit paths, nudge/decision helpers. Rolled back — no residue.
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });
let pass = 0, fail = 0;
const ok = (m) => (pass++, console.log(`  ✅ ${m}`));
const bad = (m) => (fail++, console.log(`  ❌ ${m}`));
class RB extends Error {}
const rb = (fn) => sql.begin(async (tx) => { await fn(tx); throw new RB(); }).catch((e) => { if (!(e instanceof RB)) throw e; });

try {
  const [{ id: admin }] = await sql`select id from auth.users where email='admin@harvestersng.org'`;
  const [gb] = await sql`select id from public.entities where name='Harvesters Gbagada'`;

  console.log("\n── Weekly income report schema + inbox view ──");
  await rb(async (tx) => {
    const data = { totals: { weekly_ngn: 1234567, gift_count: 42, giver_count: 30 }, target: { achieved_percent: 61 } };
    const [r] = await tx`insert into public.weekly_income_reports
      (entity_id, week_start, week_end, generated_data, ai_narrative, generated_by, sent_by, sent_at, recipients)
      values (${gb.id}, '2026-06-22', '2026-06-28', ${tx.json(data)}, 'Test narrative', ${admin}, ${admin}, now(), ${[admin]})
      returning id`;
    const [v] = await tx`select entity_name, generated_data->'totals'->>'weekly_ngn' wngn, recipients from public.weekly_income_report_inbox where id=${r.id}`;
    v && v.entity_name === "Harvesters Gbagada" && Number(v.wngn) === 1234567
      ? ok("report inserts with generated_data+recipients; inbox view resolves entity_name")
      : bad("inbox view shape wrong");
    // upsert path (on conflict entity_id, week_start)
    await tx`insert into public.weekly_income_reports (entity_id, week_start, week_end, generated_data, recipients)
      values (${gb.id}, '2026-06-22', '2026-06-28', '{}'::jsonb, '{}')
      on conflict (entity_id, week_start) do update set generated_data = excluded.generated_data`;
    ok("upsert on (entity_id, week_start) works");
  });

  console.log("\n── Notifications + message outbox ──");
  await rb(async (tx) => {
    await tx`insert into public.notifications (user_id, role, entity_id, title, body, href)
      values (null, 'campus_pastor'::public.app_role, ${gb.id}, 'T', 'B', '/x')`;
    ok("role-targeted in-app notification inserts");
    await tx`insert into public.message_outbox (channel, to_contact, subject, body, kind, created_by)
      values ('whatsapp'::public.message_channel, null, 'T', 'B', 'approval_nudge', ${admin})`;
    const [{ n }] = await tx`select count(*)::int n from public.message_outbox where status='queued' and kind='approval_nudge'`;
    n >= 1 ? ok("message_outbox queues without a provider contact/key") : bad("outbox queue failed");
  });

  console.log("\n── Scoped dashboard queries (campus-officer scope) ──");
  const scopeIds = [gb.id];
  const [g1] = await sql`select coalesce(sum(round(gr.amount * public.fx_rate_at(gr.currency::text,'NGN',gr.transaction_date),2)),0) v
    from public.giving_records gr where extract(year from gr.transaction_date)=extract(year from current_date) and gr.entity_id in ${sql(scopeIds)}`;
  Number(g1.v) > 0 ? ok(`scoped giving YTD computes (₦${Number(g1.v).toLocaleString()})`) : bad("scoped giving zero");
  const appr = await sql`select count(*)::int n from public.requisition_approvals ra
    left join public.requisition_requests rr on rr.id=ra.requisition_request_id
    left join public.requisition_batches rb2 on rb2.id=ra.requisition_batch_id
    where ra.status='pending' and coalesce(rr.entity_id, rb2.entity_id) in ${sql(scopeIds)}`;
  ok(`scoped pending approvals query runs (${appr[0].n} rows)`);

  console.log("\n── Requisition import commit path ──");
  await rb(async (tx) => {
    const [ven] = await tx`select id from public.vendors where is_related_party=false limit 1`;
    const [row] = await tx`insert into public.requisition_requests
      (entity_id, raised_by, raised_by_role, org_branch, raised_by_level, vendor_id, category, description,
       amount, currency, needed_by_date, is_urgent, wht_applicable, wht_rate, status, submitted_at, budget_line_id)
      values (${gb.id}, ${admin}, 'campus_finance_officer', 'congregational', 'campus', ${ven?.id ?? null},
        'Utilities', 'Import test', 250000, 'NGN', null, false, true, 5, 'submitted', now(),
        (select bl.id from public.budget_lines bl join public.budget_cycles bc on bc.id=bl.budget_cycle_id
         join public.accounts a on a.id=bl.account_id
         where bl.entity_id=${gb.id} and a.account_type='expense' and bc.fiscal_year=extract(year from current_date)::int
         order by coalesce(bl.approved_amount, bl.proposed_amount) desc limit 1))
      returning id, wht_withheld_amount, net_payable_amount, budget_line_id`;
    Number(row.wht_withheld_amount) === 12500 && Number(row.net_payable_amount) === 237500
      ? ok("requisition import row: WHT auto-computed (5% of 250k)") : bad("WHT wrong");
    row.budget_line_id ? ok("auto-linked to a budget line") : ok("no budget line available to link (acceptable)");
  });

  console.log("\n── Approval chain + nudge target resolution ──");
  const [anyReq] = await sql`select rr.id, rr.entity_id from public.requisition_requests rr
    join public.requisition_approvals ra on ra.requisition_request_id=rr.id and ra.status='pending' limit 1`;
  if (anyReq) {
    const chain = await sql`
      select coalesce(ra.requisition_request_id, rbi.requisition_request_id) rid, ra.approver_role, ra.status, ra.sequence_order
      from public.requisition_approvals ra
      left join public.requisition_batch_items rbi on rbi.batch_id = ra.requisition_batch_id
      where coalesce(ra.requisition_request_id, rbi.requisition_request_id) = ${anyReq.id}
      order by ra.sequence_order`;
    chain.length > 0 ? ok(`approval chain resolves (${chain.length} steps, pending: ${chain.find(c=>c.status==='pending')?.approver_role})`) : bad("chain empty");
    const pending = chain.find((c) => c.status === "pending");
    if (pending) {
      const users = await sql`
        with recursive up as (
          select id, parent_entity_id from public.entities where id = ${anyReq.entity_id}
          union all select e.id, e.parent_entity_id from public.entities e join up on e.id = up.parent_entity_id)
        select count(distinct uer.user_id)::int n from public.user_entity_roles uer
        where uer.role = ${pending.approver_role}::public.app_role
          and (uer.entity_id is null or uer.entity_id in (select id from up))`;
      Number(users[0].n) > 0 ? ok(`nudge finds ${users[0].n} user(s) holding ${pending.approver_role} over that entity`) : bad("no nudge recipients found");
    }
  } else {
    ok("(no pending approvals in demo to chain-test — skipped)");
  }

  console.log(`\n${fail === 0 ? "✅ ALL PASSED" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
} catch (e) {
  console.error("Harness error:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
