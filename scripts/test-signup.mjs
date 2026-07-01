// End-to-end auth chain test against real Supabase Auth:
// signup -> auto-confirm trigger -> bootstrap super_admin trigger.
// Cleans up the created user so the real first signup becomes super_admin.
// Usage: node --env-file=.env.local scripts/test-signup.mjs
import postgres from "postgres";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });
let fail = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => (fail++, console.log(`  ❌ ${m}`));

const email = `ci-test-${Date.now()}@harvesters.local`;
let userId = null;

try {
  // Ensure we don't clobber a real super_admin: only run if none exists yet,
  // OR run and clean up. We check existing count to report context.
  const [{ count: existing }] = await sql`
    select count(*)::int from public.user_entity_roles where role='super_admin'`;
  console.log(`\n(super_admins currently in DB: ${existing})`);

  console.log("\n── Supabase Auth signup ──");
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Test-passw0rd!" }),
  });
  const body = await res.json();
  if (!res.ok) {
    bad(`signup failed (${res.status}): ${JSON.stringify(body)}`);
  } else {
    ok(`signup succeeded for ${email}`);
    const hasSession = Boolean(body.access_token || body.session?.access_token);
    hasSession
      ? ok("session returned immediately (auto-confirm trigger works, no email step)")
      : ok("user created (session pending — confirm trigger may differ)");
  }

  const [u] = await sql`select id, email_confirmed_at from auth.users where email=${email}`;
  if (!u) {
    bad("user row not found in auth.users");
  } else {
    userId = u.id;
    u.email_confirmed_at ? ok("email auto-confirmed at DB level") : bad("email not confirmed");
    const roles = await sql`select role, entity_id from public.user_entity_roles where user_id=${u.id}`;
    if (existing === 0) {
      roles.some((r) => r.role === "super_admin" && r.entity_id === null)
        ? ok("bootstrap: first user auto-granted GLOBAL super_admin")
        : bad("bootstrap super_admin not granted");
    } else {
      roles.length === 0
        ? ok("not first user → no auto role (expected, a super_admin already exists)")
        : console.log(`  (note: user received roles: ${roles.map((r) => r.role)})`);
    }
  }
} catch (e) {
  bad(`harness error: ${e.message}`);
} finally {
  if (userId) {
    await sql`delete from auth.users where id=${userId}`;
    console.log(`\n  🧹 cleaned up test user (${email}) — real first signup will bootstrap super_admin`);
  }
  await sql.end();
  console.log(`\n${fail === 0 ? "✅ AUTH CHAIN OK" : "❌ FAILURES"}\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}
