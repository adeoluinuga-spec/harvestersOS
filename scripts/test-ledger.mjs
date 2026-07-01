// Ledger integrity + structure verification.
// Usage: node --env-file=.env.local scripts/test-ledger.mjs
// Every test runs in its own transaction and is rolled back — no residue.
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });

let pass = 0,
  fail = 0;
const ok = (m) => (pass++, console.log(`  ✅ ${m}`));
const bad = (m) => (fail++, console.log(`  ❌ ${m}`));

class Rollback extends Error {}

// Run body in a transaction, always roll back. Returns whatever body returns.
async function inTx(body) {
  let result;
  try {
    await sql.begin(async (tx) => {
      result = await body(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return result;
}

// Assert that `body` throws (a DB error). Runs in its own tx.
async function expectFail(label, body) {
  try {
    await sql.begin(async (tx) => {
      await body(tx);
      throw new Rollback(); // reached only if no error was raised => test failed
    });
    bad(`${label} — expected failure but it succeeded`);
  } catch (e) {
    if (e instanceof Rollback) bad(`${label} — expected failure but it succeeded`);
    else ok(`${label} — correctly rejected: ${e.message.split("\n")[0]}`);
  }
}

try {
  console.log("\n── Structure ──");
  const tree = await sql`
    select e.type, e.name, e.functional_currency as ccy, p.name as parent
    from public.entities e left join public.entities p on p.id = e.parent_entity_id
    order by case e.type when 'group' then 0 when 'sub_group' then 1
                         when 'campus' then 2 when 'ministry_expression' then 3 else 4 end, e.name`;
  for (const r of tree)
    console.log(`  ${r.type.padEnd(20)} ${r.name.padEnd(38)} ${r.ccy}  ${r.parent ? "← " + r.parent : ""}`);
  const [{ count: acct }] = await sql`select count(*)::int from public.accounts`;
  const intl = tree.filter((r) => r.ccy !== "NGN").length;
  intl > 0 ? ok(`${intl} non-NGN (international) entities present`) : bad("no international entity");
  acct >= 10 ? ok(`${acct} chart-of-accounts rows seeded`) : bad("COA not seeded");

  console.log("\n── Bank encryption ──");
  const banks = await sql`
    select bank_name, account_number_last4 as last4,
           public.decrypt_account_number(account_number_encrypted) as plain,
           length(account_number_encrypted) as cipher_len
    from public.bank_accounts order by bank_name`;
  for (const b of banks) {
    const roundtrips = b.plain?.endsWith(b.last4);
    roundtrips
      ? ok(`${b.bank_name}: decrypts to …${b.last4} (cipher ${b.cipher_len}B, plaintext never stored)`)
      : bad(`${b.bank_name}: decrypt mismatch`);
  }

  // Fixtures for ledger tests
  const [{ id: entity }] = await sql`select id from public.entities where name='Gbagada Campus'`;
  const [{ id: cash }] = await sql`select id from public.accounts where code='1000'`;
  const [{ id: tithes }] = await sql`select id from public.accounts where code='4000'`;

  const seedEntry = async (tx, status = "draft") => {
    const [{ id }] = await tx`
      insert into public.journal_entries (entity_id, transaction_date, description, source_module, status)
      values (${entity}, current_date, 'TEST giving', 'giving', ${status}) returning id`;
    return id;
  };
  const addLine = (tx, je, acct, dr, cr) => tx`
    insert into public.journal_entry_lines
      (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
    values (${je}, ${acct}, ${entity}, ${dr}, ${cr}, 'unrestricted', 'NGN')`;

  console.log("\n── Double-entry balance ──");
  // Balanced entry posts successfully.
  await inTx(async (tx) => {
    const je = await seedEntry(tx);
    await addLine(tx, je, cash, 100000, 0);
    await addLine(tx, je, tithes, 0, 100000);
    await tx`update public.journal_entries set status='posted' where id=${je}`;
    const [{ status }] = await tx`select status from public.journal_entries where id=${je}`;
    status === "posted" ? ok("balanced entry (Dr Cash / Cr Tithes) posts") : bad("balanced entry failed to post");
  });

  await expectFail("unbalanced entry cannot post", async (tx) => {
    const je = await seedEntry(tx);
    await addLine(tx, je, cash, 100000, 0);
    await addLine(tx, je, tithes, 0, 90000); // out of balance
    await tx`update public.journal_entries set status='posted' where id=${je}`;
  });

  await expectFail("single-line entry cannot post", async (tx) => {
    const je = await seedEntry(tx);
    await addLine(tx, je, cash, 100000, 0);
    await tx`update public.journal_entries set status='posted' where id=${je}`;
  });

  await expectFail("entry cannot be inserted directly as posted", async (tx) => {
    await seedEntry(tx, "posted");
  });

  console.log("\n── Append-only immutability ──");
  await expectFail("posted line cannot be UPDATEd", async (tx) => {
    const je = await seedEntry(tx);
    await addLine(tx, je, cash, 100000, 0);
    await addLine(tx, je, tithes, 0, 100000);
    await tx`update public.journal_entries set status='posted' where id=${je}`;
    await tx`update public.journal_entry_lines set debit_amount=1 where journal_entry_id=${je} and debit_amount>0`;
  });

  await expectFail("posted line cannot be DELETEd", async (tx) => {
    const je = await seedEntry(tx);
    await addLine(tx, je, cash, 100000, 0);
    await addLine(tx, je, tithes, 0, 100000);
    await tx`update public.journal_entries set status='posted' where id=${je}`;
    await tx`delete from public.journal_entry_lines where journal_entry_id=${je}`;
  });

  await expectFail("posted entry cannot be DELETEd", async (tx) => {
    const je = await seedEntry(tx);
    await addLine(tx, je, cash, 100000, 0);
    await addLine(tx, je, tithes, 0, 100000);
    await tx`update public.journal_entries set status='posted' where id=${je}`;
    await tx`delete from public.journal_entries where id=${je}`;
  });

  console.log("\n── Corrections via reversing entries ──");
  await inTx(async (tx) => {
    const je = await seedEntry(tx);
    await addLine(tx, je, cash, 100000, 0);
    await addLine(tx, je, tithes, 0, 100000);
    await tx`update public.journal_entries set status='posted' where id=${je}`;
    const [{ reverse_journal_entry: rev }] = await tx`select public.reverse_journal_entry(${je}, 'test reversal')`;
    const [{ status: origStatus }] = await tx`select status from public.journal_entries where id=${je}`;
    const [{ status: revStatus, reversal_of_entry_id: refId }] =
      await tx`select status, reversal_of_entry_id from public.journal_entries where id=${rev}`;
    // Reversing entry flips the sides.
    const [{ dr, cr }] = await tx`
      select sum(debit_amount) dr, sum(credit_amount) cr from public.journal_entry_lines where journal_entry_id=${rev}`;
    origStatus === "reversed" ? ok("original entry marked 'reversed'") : bad("original not reversed");
    revStatus === "posted" && refId === je
      ? ok("reversing entry posted and linked via reversal_of_entry_id")
      : bad("reversing entry wrong");
    Number(dr) === 100000 && Number(cr) === 100000 ? ok("reversing entry balances (sides flipped)") : bad("reversal unbalanced");
  });

  console.log(`\n${fail === 0 ? "✅ ALL PASSED" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
} catch (e) {
  console.error("\n❌ Harness error:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
