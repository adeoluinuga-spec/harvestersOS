// Verifies the DB-side logic the import registry depends on. Rolled back.
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });
let pass = 0, fail = 0;
const ok = (m) => (pass++, console.log(`  ✅ ${m}`));
const bad = (m) => (fail++, console.log(`  ❌ ${m}`));
class RB extends Error {}
const rb = (fn) => sql.begin(async (tx) => { await fn(tx); throw new RB(); }).catch((e) => { if (!(e instanceof RB)) throw e; });
const N = (x) => Number(x);

try {
  const [{ id: actor }] = await sql`select id from auth.users where email='admin@harvestersng.org'`;
  const ent = Object.fromEntries((await sql`select name,id from public.entities where name in ('Gbagada Campus')`).map(r=>[r.name,r.id]));
  const GB = ent["Gbagada Campus"];
  const [{ id: cash }] = await sql`select id from public.accounts where code='1000'`;
  const [{ id: obe }] = await sql`select id from public.accounts where code='3200'`;
  const [{ id: tithe }] = await sql`select id from public.giving_types where code='tithe'`;

  console.log("\n── Staging insert (jsonb raw + errors via helper) ──");
  await rb(async (tx) => {
    const [b] = await tx`insert into public.import_batches (import_type, status, file_name, total_rows, valid_rows, error_rows, uploaded_by)
      values ('givers','validated','t.csv',2,1,1,${actor}) returning id`;
    const rows = [
      { batch_id: b.id, row_number: 2, raw: tx.json({ full_name: "A" }), status: "valid", errors: null },
      { batch_id: b.id, row_number: 3, raw: tx.json({ full_name: "" }), status: "invalid", errors: tx.json([{ field: "full_name", message: "required" }]) },
    ];
    await tx`insert into public.import_rows ${tx(rows, "batch_id", "row_number", "raw", "status", "errors")}`;
    const got = await tx`select status, raw, errors from public.import_rows where batch_id=${b.id} order by row_number`;
    got.length === 2 && got[0].raw.full_name === "A" && got[1].errors[0].field === "full_name"
      ? ok("import_rows staged with jsonb raw + enum status via multi-row helper")
      : bad("staging insert shape wrong");
  });

  console.log("\n── Givers dedupe (import commit logic) ──");
  await rb(async (tx) => {
    const [g] = await tx`insert into public.givers (full_name, phone, email) values ('Ada Obi','08031234567','ada@x.com') returning id`;
    await tx`insert into public.giver_identifiers (giver_id, identifier_type, identifier_value) values (${g.id},'phone',public.normalize_phone('08031234567')) on conflict do nothing`;
    const exact = await tx`select * from public.find_giver_matches('Ada Obi','08031234567',null,3)`;
    exact.find(m=>m.is_exact)?.giver_id === g.id ? ok("re-import of same phone resolves to existing giver (no dup)") : bad("exact dedupe failed");
    const fuzzy = await tx`select * from public.find_giver_matches('Ada Obi','08031234568',null,3)`;
    const f = fuzzy[0];
    f && !f.is_exact && f.score > 0.5 ? ok(`near-match flagged for merge review (score ${f.score.toFixed(2)})`) : bad("fuzzy flag failed");
  });

  console.log("\n── Historical giving import → ledger ──");
  await rb(async (tx) => {
    const [gr] = await tx`insert into public.giving_records
      (giver_id, entity_id, recording_entity_id, attribution_entity_id, giving_type_id, amount, currency, channel, transaction_date, recorded_by)
      values (null, ${GB}, ${GB}, ${GB}, ${tithe}, 75000, 'NGN', 'cash', '2025-03-01', ${actor}) returning id`;
    const [{ post_giving_record: je }] = await tx`select public.post_giving_record(${gr.id})`;
    const [{ status }] = await tx`select status from public.journal_entries where id=${je}`;
    const [{ dr, cr }] = await tx`select sum(debit_amount) dr, sum(credit_amount) cr from public.journal_entry_lines where journal_entry_id=${je}`;
    status === "posted" && N(dr) === 75000 && N(cr) === 75000 ? ok("imported gift posts a balanced JE (₦75,000)") : bad("giving import ledger post failed");
  });

  console.log("\n── Opening balances import → balanced JE (OBE plug) ──");
  await rb(async (tx) => {
    // Mirror the grouped commit: Cash debit 1,000,000 -> plug OBE credit 1,000,000
    const [je] = await tx`insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
      values (${GB}, '2025-12-31', 'Opening balance', 'opening_balance', ${actor}, 'draft') returning id`;
    await tx`insert into public.journal_entry_lines (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
      values (${je.id}, ${cash}, ${GB}, 1000000, 0, 'unrestricted', 'NGN')`;
    const net = 1000000;
    await tx`insert into public.journal_entry_lines (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
      values (${je.id}, ${obe}, ${GB}, ${net<0?-net:0}, ${net>0?net:0}, 'unrestricted', 'NGN')`;
    await tx`update public.journal_entries set status='posted' where id=${je.id}`;
    const [{ status }] = await tx`select status from public.journal_entries where id=${je.id}`;
    const [{ dr, cr }] = await tx`select sum(debit_amount) dr, sum(credit_amount) cr from public.journal_entry_lines where journal_entry_id=${je.id}`;
    status === "posted" && N(dr) === N(cr) ? ok(`opening balance JE balances via Opening Balance Equity plug (₦${N(dr).toLocaleString()})`) : bad("opening balance plug failed");
  });

  console.log("\n── Bank statement import → bank_feed_transactions ──");
  await rb(async (tx) => {
    const [ba] = await tx`select id from public.bank_accounts where entity_id=${GB} limit 1`;
    if (!ba) { bad("no seeded bank account on Gbagada to test"); return; }
    const [row] = await tx`insert into public.bank_feed_transactions
      (bank_account_id, provider, external_transaction_id, transaction_date, amount, currency, description)
      values (${ba.id}, 'manual', 'test-ref-1', '2025-03-02', 50000, 'NGN', 'TRF/OFFERING') returning id`;
    row?.id ? ok("bank statement line ingests as a manual bank_feed_transaction") : bad("bank feed insert failed");
  });

  console.log(`\n${fail === 0 ? "✅ ALL PASSED" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
} catch (e) {
  console.error("Harness error:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
