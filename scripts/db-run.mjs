// Direct Postgres SQL runner for Harvesters Finance OS.
// Usage: node --env-file=.env.local scripts/db-run.mjs <file1.sql> [file2.sql ...]
// Executes each file's full contents (multi-statement, simple protocol) in order.
import fs from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set. Run with: node --env-file=.env.local ...");
  process.exit(1);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("No SQL files provided.");
  process.exit(1);
}

const sql = postgres(url, { ssl: "require", prepare: false, max: 1 });

try {
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    process.stdout.write(`\n▶ Running ${file} ... `);
    await sql.unsafe(content).simple();
    process.stdout.write("done\n");
  }
  console.log("\n✅ All files executed successfully.");
} catch (err) {
  console.error(`\n❌ Error: ${err.message}`);
  if (err.position) console.error(`   at position ${err.position}`);
  if (err.detail) console.error(`   detail: ${err.detail}`);
  if (err.where) console.error(`   where: ${err.where}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
