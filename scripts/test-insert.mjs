// Verifies the exact parameterized enum-cast INSERT shape used by the admin
// server actions (lib/repo.ts). Rolled back — no residue.
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });
class Rollback extends Error {}
try {
  const [{ id: parent }] = await sql`select id from public.entities where name='Harvesters Nigeria'`;
  await sql.begin(async (tx) => {
    // entity insert (mirrors insertEntity)
    const type = "campus", legal = "unincorporated_unit";
    const [ent] = await tx`
      insert into public.entities
        (type, parent_entity_id, name, country, functional_currency, legal_status, start_date, end_date)
      values (${type}::public.entity_type, ${parent}, ${"Ikorodu Campus (TEST)"}, ${"NG"},
              ${"NGN"}, ${legal}::public.legal_status, ${null}::date, ${null}::date)
      returning id, type, name`;
    console.log("  ✅ entity insert via parameterized enum cast:", ent.name, `(${ent.type})`);

    // account insert (mirrors insertAccount)
    const [acc] = await tx`
      insert into public.accounts (code, name, account_type, fund_classification)
      values (${"9999"}, ${"Test Account"}, ${"income"}::public.account_type,
              ${"unrestricted"}::public.fund_classification)
      returning code, name, account_type`;
    console.log("  ✅ account insert via parameterized enum cast:", acc.code, acc.name, `(${acc.account_type})`);
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { console.error("  ❌", e.message); process.exitCode = 1; }
} finally {
  await sql.end();
  console.log("  (rolled back — no test data persisted)");
}
