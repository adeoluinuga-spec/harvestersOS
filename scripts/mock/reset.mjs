// Wipe ALL mock/demo data and restore the pre-seed baseline, in one command.
// Usage: node --env-file=.env.local scripts/mock/reset.mjs
import { sql, reset } from "./lib.mjs";
try {
  await reset();
} catch (e) {
  console.error("❌ Reset failed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
