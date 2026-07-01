// Auth/RBAC/SoD/audit verification. Rolled back — no residue.
// Usage: node --env-file=.env.local scripts/test-auth.mjs
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });
let pass = 0, fail = 0;
const ok = (m) => (pass++, console.log(`  ✅ ${m}`));
const bad = (m) => (fail++, console.log(`  ❌ ${m}`));
class Rollback extends Error {}
const rollback = (fn) => sql.begin(async (tx) => { await fn(tx); throw new Rollback(); })
  .catch((e) => { if (!(e instanceof Rollback)) throw e; });

// Minimal auth.users insert (GoTrue-compatible enough for FK + our triggers).
const mkUser = async (tx, email) => {
  const [u] = await tx`
    insert into auth.users (instance_id, id, aud, role, email)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
            'authenticated', 'authenticated', ${email})
    returning id`;
  return u.id;
};

try {
  const ent = Object.fromEntries(
    (await sql`select name, id from public.entities`).map((r) => [r.name, r.id])
  );
  const [{ id: cash }] = await sql`select id from public.accounts where code='1000'`;
  const [{ id: tithes }] = await sql`select id from public.accounts where code='4000'`;

  console.log("\n── Bootstrap + global roles ──");
  await rollback(async (tx) => {
    const u1 = await mkUser(tx, "founder@test.local");
    const [{ is_super_admin: sa }] = await tx`select public.is_super_admin(${u1})`;
    sa ? ok("first-ever user auto-granted super_admin (bootstrap)") : bad("bootstrap failed");
    const [{ count: all }] = await tx`select count(*)::int from public.entities`;
    const [{ count: acc }] = await tx`select count(*)::int from public.accessible_entity_ids(${u1}) x`;
    acc === all ? ok(`super_admin sees all ${all} entities`) : bad(`super_admin sees ${acc}/${all}`);
  });

  console.log("\n── Entity-scoped access + hierarchy cascade ──");
  await rollback(async (tx) => {
    await mkUser(tx, "founder2@test.local"); // consume bootstrap slot
    const cfo = await mkUser(tx, "gbagada.cfo@test.local");
    await tx`insert into public.user_entity_roles (user_id, entity_id, role)
             values (${cfo}, ${ent["Gbagada Campus"]}, 'campus_finance_officer')`;
    const acc = (await tx`select public.accessible_entity_ids(${cfo}) as id`).map((r) => r.id);
    acc.includes(ent["Gbagada Campus"]) ? ok("campus CFO sees own campus") : bad("missing own campus");
    acc.includes(ent["The Harvest Conference 2026"])
      ? ok("cascade: sees Event hosted under the campus") : bad("cascade to child event failed");
    !acc.includes(ent["Lekki Campus"]) ? ok("cannot see sibling campus (Lekki)") : bad("LEAK: sees Lekki");
    !acc.includes(ent["London Campus"]) ? ok("cannot see other sub-group campus (London)") : bad("LEAK: sees London");
  });

  await rollback(async (tx) => {
    await mkUser(tx, "founder3@test.local");
    const sgfo = await mkUser(tx, "ng.finance@test.local");
    await tx`insert into public.user_entity_roles (user_id, entity_id, role)
             values (${sgfo}, ${ent["Harvesters Nigeria"]}, 'sub_group_finance_officer')`;
    const acc = (await tx`select public.accessible_entity_ids(${sgfo}) as id`).map((r) => r.id);
    const seesNgTree =
      acc.includes(ent["Harvesters Nigeria"]) &&
      acc.includes(ent["Gbagada Campus"]) &&
      acc.includes(ent["Lekki Campus"]) &&
      acc.includes(ent["The Harvest Conference 2026"]);
    seesNgTree ? ok("sub-group officer sees whole Nigeria sub-tree") : bad("sub-tree cascade incomplete");
    !acc.includes(ent["London Campus"]) ? ok("does not see UK sub-tree") : bad("LEAK: sees London");
  });

  console.log("\n── Global-scope constraint ──");
  await rollback(async (tx) => {
    await mkUser(tx, "founder4@test.local");
    const u = await mkUser(tx, "bad@test.local");
    try {
      await tx`insert into public.user_entity_roles (user_id, entity_id, role)
               values (${u}, null, 'campus_finance_officer')`;
      bad("scoped role wrongly allowed with null entity");
    } catch { ok("scoped role rejected without an entity (check constraint)"); }
  });

  console.log("\n── Automatic audit logging (actor via app.current_user_id) ──");
  await rollback(async (tx) => {
    const u1 = await mkUser(tx, "founder5@test.local");
    await tx`select set_config('app.current_user_id', ${u1}, true)`;
    const [e] = await tx`
      insert into public.entities (type, parent_entity_id, name, country, functional_currency, legal_status)
      values ('campus', ${ent["Harvesters Nigeria"]}, 'Audit Test Campus', 'NG', 'NGN', 'unincorporated_unit')
      returning id`;
    const [a] = await tx`
      select actor_id, action, table_name, entity_id from public.audit_log
      where table_name='entities' and record_id=${e.id}::text order by id desc limit 1`;
    a && a.actor_id === u1 && a.action === "create"
      ? ok(`entity create auto-logged with actor + action (${a.action})`) : bad("audit row missing/incorrect");
  });

  console.log("\n── Segregation of duties (creator ≠ approver) ──");
  await rollback(async (tx) => {
    const creator = await mkUser(tx, "founder6@test.local");
    const approver = await mkUser(tx, "approver@test.local");
    const mkEntry = async () => {
      const [je] = await tx`
        insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
        values (${ent["Gbagada Campus"]}, current_date, 'SoD test', 'giving', ${creator}, 'draft') returning id`;
      await tx`insert into public.journal_entry_lines (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
               values (${je.id}, ${cash}, ${ent["Gbagada Campus"]}, 50000, 0, 'unrestricted', 'NGN')`;
      await tx`insert into public.journal_entry_lines (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
               values (${je.id}, ${tithes}, ${ent["Gbagada Campus"]}, 0, 50000, 'unrestricted', 'NGN')`;
      return je.id;
    };

    // App layer: detect creator == approver, log the attempt (committed), refuse.
    const je1 = await mkEntry();
    await tx`select public.log_sod_violation(${je1}, ${creator}, 'attempted self-approval')`;
    const [{ count: v }] = await tx`
      select count(*)::int from public.audit_log where action='sod_violation' and record_id=${je1}::text`;
    v > 0 ? ok("SoD violation durably logged (app layer, survives refusal)") : bad("violation not logged");

    // DB backstop: even if the app is bypassed, posting raises.
    try {
      await tx.savepoint(async (sp) => { await sp`select public.post_journal_entry(${je1}, ${creator})`; });
      bad("SoD backstop NOT enforced — creator approved own entry");
    } catch {
      ok("DB backstop: creator blocked from posting own entry");
    }

    // A different approver succeeds.
    const je2 = await mkEntry();
    await tx`select public.post_journal_entry(${je2}, ${approver})`;
    const [{ status, approved_by }] = await tx`select status, approved_by from public.journal_entries where id=${je2}`;
    status === "posted" && approved_by === approver
      ? ok("a different approver can post the entry") : bad("valid approval failed");
    const [{ count: appr }] = await tx`
      select count(*)::int from public.audit_log where action='approve' and record_id=${je2}::text`;
    appr > 0 ? ok("approval auto-logged as 'approve' action") : bad("approve not audited");
  });

  console.log(`\n${fail === 0 ? "✅ ALL PASSED" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
} catch (e) {
  console.error("\n❌ Harness error:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
