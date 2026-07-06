// One-time (per environment) provisioning of the least-privilege DB logins
// created by migration 0026: sets strong passwords for hfos_app / hfos_ai,
// verifies each can connect and is properly fenced, and writes
// APP_DATABASE_URL / AI_DATABASE_URL into .env.local.
//
// Usage: node --env-file=.env.local scripts/provision-db-roles.mjs
//
// Re-runnable: rotates both passwords each run (connection strings updated).
import fs from "node:fs";
import crypto from "node:crypto";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set."); process.exit(1); }

const admin = postgres(url, { ssl: "require", prepare: false, max: 1 });

// Build a same-host connection string for another role. Supabase's pooler
// expects the username as <role>.<project-ref> when the owner is
// postgres.<project-ref>; direct connections just use the role name.
function urlForRole(role, password) {
  const u = new URL(url);
  const ownerUser = decodeURIComponent(u.username);
  const dot = ownerUser.indexOf(".");
  u.username = encodeURIComponent(dot === -1 ? role : `${role}.${ownerUser.slice(dot + 1)}`);
  u.password = encodeURIComponent(password);
  return u.toString();
}

const pw = () => crypto.randomBytes(24).toString("base64url");

function upsertEnv(key, value) {
  const path = ".env.local";
  let text = fs.readFileSync(path, "utf8");
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=`, "m").test(text)) {
    text = text.replace(new RegExp(`^${key}=.*$`, "m"), line);
  } else {
    text = text.trimEnd() + "\n" + line + "\n";
  }
  fs.writeFileSync(path, text);
}

// The Supabase pooler (Supavisor) caches role credentials briefly, so a just-
// rotated password can fail auth for a short window. Reuse the stored password
// when one exists; otherwise rotate once and retry the first connect.
function existingPassword(envKey, role) {
  const v = process.env[envKey];
  if (!v) return null;
  try {
    const u = new URL(v);
    return decodeURIComponent(u.username).startsWith(role) ? decodeURIComponent(u.password) : null;
  } catch { return null; }
}

async function connectWithRetry(connUrl, label, tries = 8, delayMs = 5000) {
  for (let i = 1; ; i++) {
    const c = postgres(connUrl, { ssl: "require", prepare: false, max: 1, connect_timeout: 15 });
    try {
      await c`select 1`;
      return c;
    } catch (e) {
      await c.end({ timeout: 1 }).catch(() => {});
      if (i >= tries) throw e;
      console.log(`  ${label}: auth not ready yet (${e.message}) — retry ${i}/${tries - 1} in ${delayMs / 1000}s`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

try {
  let appPw = existingPassword("APP_DATABASE_URL", "hfos_app");
  let aiPw = existingPassword("AI_DATABASE_URL", "hfos_ai");
  if (!appPw) { appPw = pw(); await admin.unsafe(`alter role hfos_app password '${appPw}'`); }
  if (!aiPw) { aiPw = pw(); await admin.unsafe(`alter role hfos_ai password '${aiPw}'`); }
  console.log("Passwords ready for hfos_app and hfos_ai.");

  const appUrl = urlForRole("hfos_app", appPw);
  const aiUrl = urlForRole("hfos_ai", aiPw);

  // --- Verify hfos_app: can read + write DML, cannot DDL --------------------
  const app = await connectWithRetry(appUrl, "hfos_app");
  const [{ n }] = await app`select count(*)::int n from public.entities`;
  console.log(`hfos_app connect OK (sees ${n} entities).`);
  try {
    await app.unsafe("create table public.__ddl_probe(x int)");
    console.error("❌ hfos_app was able to run DDL — investigate grants!");
    process.exitCode = 1;
  } catch {
    console.log("hfos_app DDL correctly refused.");
  }
  await app.end();

  // --- Verify hfos_ai: reads views, cannot write, cannot touch auth ---------
  const ai = await connectWithRetry(aiUrl, "hfos_ai");
  await ai`select * from public.analytics_giving_monthly limit 1`;
  console.log("hfos_ai analytics view read OK.");
  let fenced = true;
  try { await ai.unsafe("insert into public.notifications (title, body) values ('x','x')"); fenced = false; } catch { /* expected: read-only */ }
  try { await ai`select count(*) from auth.users`; fenced = false; } catch { /* expected: no auth access */ }
  try { await ai`select account_number_encrypted from public.bank_accounts limit 1`; fenced = false; } catch { /* expected: not in closure */ }
  console.log(fenced ? "hfos_ai correctly fenced (read-only, no auth, no bank secrets)." : "❌ hfos_ai fence FAILED — investigate!");
  if (!fenced) process.exitCode = 1;
  await ai.end();

  upsertEnv("APP_DATABASE_URL", appUrl);
  upsertEnv("AI_DATABASE_URL", aiUrl);
  console.log("\n✅ .env.local updated with APP_DATABASE_URL and AI_DATABASE_URL.");
  console.log("   Set the same values in production hosting. The app uses them automatically.");
} catch (e) {
  console.error("❌", e.message);
  process.exitCode = 1;
} finally {
  await admin.end();
}
