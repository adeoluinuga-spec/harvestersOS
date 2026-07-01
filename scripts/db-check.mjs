// Connectivity + inspection check.
// Usage: node --env-file=.env.local scripts/db-check.mjs
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  ssl: "require",
  prepare: false,
  max: 1,
});

try {
  const [{ version }] = await sql`select version()`;
  console.log("Connected:", version.split(" ").slice(0, 2).join(" "));
  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name`;
  console.log(
    "public tables:",
    tables.length ? tables.map((t) => t.table_name).join(", ") : "(none)"
  );
  const ext = await sql`select extname from pg_extension order by extname`;
  console.log("extensions:", ext.map((e) => e.extname).join(", "));
} catch (err) {
  console.error("❌", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
