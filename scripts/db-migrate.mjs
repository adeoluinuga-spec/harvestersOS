// Tracked migration runner for Harvesters Finance OS.
//
// Replaces ad-hoc `db-run.mjs` for schema changes: every applied migration is
// recorded in public.schema_migrations (filename, checksum, timing), so any
// environment can be brought up to date with one command and drift is visible.
//
// Usage:
//   node --env-file=.env.local scripts/db-migrate.mjs status     # what is applied / pending
//   node --env-file=.env.local scripts/db-migrate.mjs up         # apply all pending, in order
//   node --env-file=.env.local scripts/db-migrate.mjs baseline   # record existing files as applied WITHOUT running them
//
// Rules:
//   • Files run in filename order from supabase/migrations/*.sql.
//   • An applied file whose checksum has changed is reported as DRIFT (never re-run).
//   • Each file executes as one script (simple protocol), same as db-run.mjs did.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set. Run with: node --env-file=.env.local ...");
  process.exit(1);
}

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const cmd = process.argv[2] ?? "status";

const sql = postgres(url, { ssl: "require", prepare: false, max: 1 });

// Normalize line endings so git autocrlf checkouts hash identically everywhere.
const checksum = (s) =>
  crypto.createHash("sha256").update(s.replace(/\r\n/g, "\n")).digest("hex");

async function ensureTable() {
  await sql`
    create table if not exists public.schema_migrations (
      filename     text primary key,
      checksum     text not null,
      applied_at   timestamptz not null default now(),
      execution_ms integer,
      baselined    boolean not null default false
    )`;
  // Keep clients away from migration bookkeeping.
  await sql`alter table public.schema_migrations enable row level security`;
  await sql`revoke all on public.schema_migrations from anon, authenticated`;
}

function localFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => {
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      return { filename: f, content, checksum: checksum(content) };
    });
}

async function state() {
  const applied = await sql`select filename, checksum, baselined from public.schema_migrations`;
  const appliedBy = new Map(applied.map((r) => [r.filename, r]));
  const files = localFiles();
  const pending = files.filter((f) => !appliedBy.has(f.filename));
  const drift = files.filter(
    (f) => appliedBy.has(f.filename) && appliedBy.get(f.filename).checksum !== f.checksum
  );
  return { files, appliedBy, pending, drift };
}

try {
  await ensureTable();
  const { files, appliedBy, pending, drift } = await state();

  if (cmd === "status") {
    for (const f of files) {
      const a = appliedBy.get(f.filename);
      const mark = !a ? "PENDING" : a.checksum !== f.checksum ? "DRIFT  " : a.baselined ? "baseln " : "applied";
      console.log(`${mark}  ${f.filename}`);
    }
    console.log(`\n${files.length} files · ${pending.length} pending · ${drift.length} drift`);
    if (drift.length) process.exitCode = 2;
  } else if (cmd === "baseline") {
    let n = 0;
    for (const f of files) {
      if (appliedBy.has(f.filename)) continue;
      await sql`
        insert into public.schema_migrations (filename, checksum, baselined)
        values (${f.filename}, ${f.checksum}, true)`;
      n++;
    }
    console.log(`Baselined ${n} file(s) as already applied (not executed).`);
  } else if (cmd === "up") {
    if (drift.length) {
      console.error("❌ Refusing to migrate: applied files changed on disk:");
      drift.forEach((d) => console.error("   " + d.filename));
      process.exit(2);
    }
    if (pending.length === 0) {
      console.log("Nothing to do — database is up to date.");
    }
    for (const f of pending) {
      process.stdout.write(`▶ ${f.filename} ... `);
      const t0 = Date.now();
      await sql.unsafe(f.content).simple();
      const ms = Date.now() - t0;
      await sql`
        insert into public.schema_migrations (filename, checksum, execution_ms)
        values (${f.filename}, ${f.checksum}, ${ms})`;
      process.stdout.write(`done (${ms}ms)\n`);
    }
    if (pending.length) console.log(`\n✅ Applied ${pending.length} migration(s).`);
  } else {
    console.error(`Unknown command: ${cmd}. Use status | up | baseline.`);
    process.exit(1);
  }
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  if (err.where) console.error(`   where: ${err.where}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
