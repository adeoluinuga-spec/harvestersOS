// Givings verification: ledger integration, giver identity/fuzzy match, merge,
// pledge aging/fulfillment, statement. All rolled back — no residue.
// Usage: node --env-file=.env.local scripts/test-givings.mjs
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });
let pass = 0, fail = 0;
const ok = (m) => (pass++, console.log(`  ✅ ${m}`));
const bad = (m) => (fail++, console.log(`  ❌ ${m}`));
class Rollback extends Error {}
const rollback = (fn) => sql.begin(async (tx) => { await fn(tx); throw new Rollback(); })
  .catch((e) => { if (!(e instanceof Rollback)) throw e; });
const N = (x) => Number(x);

const mkGiver = async (tx, name, phone, email, entity) => {
  const [g] = await tx`insert into public.givers (full_name, phone, email, primary_entity_id)
    values (${name}, ${phone}, ${email}, ${entity}) returning id`;
  if (phone) await tx`insert into public.giver_identifiers (giver_id, identifier_type, identifier_value, entity_id_recorded_at)
    values (${g.id}, 'phone', public.normalize_phone(${phone}), ${entity})`;
  if (email) await tx`insert into public.giver_identifiers (giver_id, identifier_type, identifier_value, entity_id_recorded_at)
    values (${g.id}, 'email', public.normalize_email(${email}), ${entity})`;
  return g.id;
};
const record = async (tx, { giver, entity, typeCode, amount, channel = "cash" }) => {
  const [{ id: typeId }] = await tx`select id from public.giving_types where code=${typeCode}`;
  const [gr] = await tx`insert into public.giving_records
      (giver_id, entity_id, giving_type_id, amount, currency, channel, transaction_date)
    values (${giver}, ${entity}, ${typeId}, ${amount}, 'NGN', ${channel}::public.giving_channel, current_date)
    returning id`;
  const [{ post_giving_record: je }] = await tx`select public.post_giving_record(${gr.id})`;
  return { grId: gr.id, je };
};

try {
  const ent = Object.fromEntries((await sql`select name, id from public.entities`).map((r) => [r.name, r.id]));
  const GB = ent["Gbagada Campus"], NLP = ent["Next Level Prayers"];

  console.log("\n── Giving posts to the ledger (double-entry) ──");
  await rollback(async (tx) => {
    const g = await mkGiver(tx, "John Ade", "08031234567", "john@example.com", GB);
    const { je } = await record(tx, { giver: g, entity: GB, typeCode: "tithe", amount: 100000, channel: "cash" });
    const [{ status }] = await tx`select status from public.journal_entries where id=${je}`;
    const lines = await tx`select a.code, l.debit_amount dr, l.credit_amount cr
      from public.journal_entry_lines l join public.accounts a on a.id=l.account_id
      where l.journal_entry_id=${je} order by a.code`;
    status === "posted" ? ok("giving auto-posts a journal entry") : bad("JE not posted");
    const cash = lines.find((l) => l.code === "1000"), tithe = lines.find((l) => l.code === "4000");
    cash && N(cash.dr) === 100000 ? ok("debits Cash on Hand ₦100,000 (cash channel)") : bad("wrong debit");
    tithe && N(tithe.cr) === 100000 ? ok("credits Tithes income ₦100,000") : bad("wrong credit");
    const [{ jid }] = await tx`select journal_entry_id jid from public.giving_records where journal_entry_id=${je}`;
    jid === je ? ok("giving_record linked to its journal entry (no parallel balance)") : bad("link missing");

    // bank channel debits Bank - Operations instead of Cash
    const { je: je2 } = await record(tx, { giver: g, entity: GB, typeCode: "offering", amount: 5000, channel: "online_paystack" });
    const [{ code }] = await tx`select a.code from public.journal_entry_lines l join public.accounts a on a.id=l.account_id
      where l.journal_entry_id=${je2} and l.debit_amount>0`;
    code === "1010" ? ok("non-cash channel debits Bank - Operations") : bad(`expected 1010, got ${code}`);
  });

  console.log("\n── Unique giver identity + fuzzy match ──");
  await rollback(async (tx) => {
    const g = await mkGiver(tx, "John Ade", "08031234567", "john@example.com", GB);
    const exact = await tx`select * from public.find_giver_matches('John Ade','08031234567',null,5)`;
    exact[0]?.giver_id === g && exact[0]?.is_exact && exact[0]?.reason === "phone"
      ? ok("exact phone resolves to the same giver (no duplicate)") : bad("exact match failed");

    const fuzzy = await tx`select * from public.find_giver_matches('Jon Ade','08031234568',null,5)`;
    const top = fuzzy[0];
    top?.giver_id === g && !top?.is_exact && top?.score > 0.5
      ? ok(`near-match (transposed digit) flagged fuzzy, not exact (score ${top.score.toFixed(2)})`)
      : bad("fuzzy near-match not detected correctly");

    const none = await tx`select * from public.find_giver_matches('Zebedee Xylophone','09990001111',null,5)`;
    (none.length === 0 || none[0].score < 0.3) ? ok("unrelated details produce no strong match") : bad("false positive");
  });

  console.log("\n── One giver, multiple entities, unified history ──");
  await rollback(async (tx) => {
    const g = await mkGiver(tx, "Grace Bello", "08050001111", "grace@example.com", GB);
    await record(tx, { giver: g, entity: GB, typeCode: "tithe", amount: 80000 });
    await record(tx, { giver: g, entity: NLP, typeCode: "partnership", amount: 25000, channel: "bank_transfer" });
    const rows = await tx`select entity_id, count(*)::int n, sum(amount) total from public.giving_records
      where giver_id=${g} group by entity_id`;
    rows.length === 2 ? ok("gifts recorded at two different entities") : bad("multi-entity giving missing");
    const [{ total }] = await tx`select sum(amount) total from public.giving_records where giver_id=${g}`;
    N(total) === 105000 ? ok("all gifts roll up to ONE giver_id (₦105,000 unified)") : bad("history not unified");
  });

  console.log("\n── Merge duplicate givers ──");
  await rollback(async (tx) => {
    const keep = await mkGiver(tx, "Samuel Okoro", "08061112222", "sam@example.com", GB);
    const dup = await mkGiver(tx, "Sam Okoro", "08061112223", null, GB);
    await record(tx, { giver: keep, entity: GB, typeCode: "tithe", amount: 40000 });
    await record(tx, { giver: dup, entity: GB, typeCode: "offering", amount: 10000 });
    await tx`select public.merge_givers(${keep}, ${dup})`;
    const [{ total }] = await tx`select sum(amount) total from public.giving_records where giver_id=${keep}`;
    const [{ is_active }] = await tx`select is_active from public.givers where id=${dup}`;
    N(total) === 50000 ? ok("merged: gifts repointed to surviving giver (₦50,000)") : bad("merge did not repoint");
    is_active === false ? ok("merged giver deactivated") : bad("duplicate not deactivated");
  });

  console.log("\n── Pledges: fulfillment + AR aging ──");
  await rollback(async (tx) => {
    const g = await mkGiver(tx, "Deborah Musa", "08070003333", null, GB);
    const [p] = await tx`insert into public.pledges
      (giver_id, entity_id, pledge_type, total_pledged_amount, currency, target_fulfillment_date)
      values (${g}, ${GB}, 'building_fund', 500000, 'NGN', current_date - 45) returning id`;
    const { grId } = await record(tx, { giver: g, entity: GB, typeCode: "building_fund", amount: 200000, channel: "bank_transfer" });
    await tx`insert into public.pledge_fulfillments (pledge_id, giving_record_id, amount) values (${p.id}, ${grId}, 200000)`;
    let [b] = await tx`select outstanding_amount, fulfilled_amount from public.pledge_balances where id=${p.id}`;
    N(b.outstanding_amount) === 300000 ? ok("outstanding auto-calculated (₦300,000)") : bad("outstanding wrong");
    const [ag] = await tx`select aging_bucket from public.pledge_aging where pledge_id=${p.id}`;
    ag.aging_bucket === "31-60" ? ok(`aging bucket correct for 45-days overdue (${ag.aging_bucket})`) : bad(`bucket=${ag.aging_bucket}`);

    const { grId: g2 } = await record(tx, { giver: g, entity: GB, typeCode: "building_fund", amount: 300000, channel: "bank_transfer" });
    await tx`insert into public.pledge_fulfillments (pledge_id, giving_record_id, amount) values (${p.id}, ${g2}, 300000)`;
    const [{ status }] = await tx`select status from public.pledges where id=${p.id}`;
    status === "fulfilled" ? ok("pledge auto-marked fulfilled when fully paid") : bad("status not fulfilled");
  });

  console.log("\n── Giving statement (per giver, per year) ──");
  await rollback(async (tx) => {
    const g = await mkGiver(tx, "Esther John", "08080004444", "esther@example.com", GB);
    await record(tx, { giver: g, entity: GB, typeCode: "tithe", amount: 120000 });
    await record(tx, { giver: g, entity: GB, typeCode: "offering", amount: 8000 });
    await record(tx, { giver: g, entity: NLP, typeCode: "partnership", amount: 50000, channel: "bank_transfer" });
    const byType = await tx`select gt.name, sum(gr.amount) total from public.giving_records gr
      join public.giving_types gt on gt.id=gr.giving_type_id
      where gr.giver_id=${g} and extract(year from gr.transaction_date)=extract(year from current_date)
      group by gt.name order by gt.name`;
    const byEntity = await tx`select e.name, sum(gr.amount) total from public.giving_records gr
      join public.entities e on e.id=gr.entity_id where gr.giver_id=${g} group by e.name`;
    const [{ total }] = await tx`select sum(amount) total from public.giving_records where giver_id=${g}`;
    byType.length === 3 ? ok("statement: breakdown by giving type (3 types)") : bad("type breakdown wrong");
    byEntity.length === 2 ? ok("statement: breakdown by entity (2 entities)") : bad("entity breakdown wrong");
    N(total) === 178000 ? ok("statement: grand total ₦178,000") : bad(`total=${total}`);
  });

  console.log(`\n${fail === 0 ? "✅ ALL PASSED" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
} catch (e) {
  console.error("\n❌ Harness error:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
