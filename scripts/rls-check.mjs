// RLS + grants verification. Usage: node --env-file=.env.local scripts/rls-check.mjs
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });
let fail = 0;
try {
  console.log("\n── RLS enabled ──");
  const rls = await sql`
    select relname, relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relkind='r' order by relname`;
  for (const t of rls) {
    t.relrowsecurity ? console.log(`  ✅ ${t.relname}`) : (fail++, console.log(`  ❌ ${t.relname} — RLS OFF`));
  }

  console.log("\n── Policies ──");
  const pol = await sql`select tablename, policyname, cmd, roles from pg_policies where schemaname='public' order by tablename`;
  for (const p of pol) console.log(`  • ${p.tablename}: ${p.policyname} (${p.cmd}) → ${p.roles}`);

  console.log("\n── anon privileges on public tables (should be empty) ──");
  const anon = await sql`
    select table_name, privilege_type from information_schema.role_table_grants
    where grantee='anon' and table_schema='public' order by table_name`;
  if (anon.length === 0) console.log("  ✅ anon has no table privileges");
  else { fail++; anon.forEach((a) => console.log(`  ❌ anon can ${a.privilege_type} ${a.table_name}`)); }

  console.log("\n── authenticated privileges (should be SELECT only) ──");
  const auth = await sql`
    select table_name, privilege_type from information_schema.role_table_grants
    where grantee='authenticated' and table_schema='public' order by table_name, privilege_type`;
  const nonSelect = auth.filter((a) => a.privilege_type !== "SELECT");
  auth.forEach((a) => console.log(`  • authenticated ${a.privilege_type} ${a.table_name}`));
  if (nonSelect.length === 0) console.log("  ✅ authenticated is read-only");
  else { fail++; console.log("  ❌ authenticated has write privileges"); }

  console.log(`\n${fail === 0 ? "✅ RLS baseline OK" : "❌ RLS issues"}\n`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  await sql.end();
}
