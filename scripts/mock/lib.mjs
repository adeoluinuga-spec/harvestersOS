// Shared helpers for the Harvesters mock-data seed + reset.
// The whole demo dataset is reversible: we snapshot the pre-seed baseline, and
// reset() TRUNCATEs the transactional tables (TRUNCATE bypasses the row-level
// immutability guard by design) and deletes only demo entities/users/roles,
// then restores the captured baseline exactly.
import postgres from "postgres";

export const sql = postgres(process.env.DATABASE_URL, {
  ssl: "require",
  prepare: false,
  max: 1,
  idle_timeout: 30,
  connect_timeout: 30,
});

// --- Currencies + FX (to NGN) ----------------------------------------------
export const FX_TO_NGN = { NGN: 1, GBP: 2050, USD: 1600, AUD: 1050, CAD: 1180 };

// --- Random helpers --------------------------------------------------------
export const rnd = (min, max) => Math.random() * (max - min) + min;
export const rndInt = (min, max) => Math.floor(rnd(min, max + 1));
export const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
export const round2 = (n) => Math.round(n * 100) / 100;
export const money = (n) => round2(n);

// last N whole months (Date objects at day 1), oldest first, ending current month
export function lastMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  }
  return out;
}
export const iso = (d) => d.toISOString().slice(0, 10);
// a random date within a given month, never in the future — the ledger
// rejects future-dated postings (migration 0023), and "live" data must not
// contain income that has not happened yet.
export function dayIn(monthDate) {
  const now = new Date();
  const y = monthDate.getFullYear();
  const m = monthDate.getMonth();
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth();
  const days = isCurrentMonth
    ? now.getDate()
    : new Date(y, m + 1, 0).getDate();
  return new Date(y, m, rndInt(1, days));
}

// --- Name generators -------------------------------------------------------
const NG_FIRST = ["Ada","Chidi","Emeka","Ngozi","Tunde","Bola","Femi","Yemi","Sola","Kunle","Ifeoma","Chioma","Oluwaseun","Damilola","Ayodeji","Folake","Gbenga","Nkechi","Uche","Obinna","Halima","Ibrahim","Aisha","Musa","Grace","Blessing","Victor","Peace","Samuel","Deborah","Esther","John","Mary","Daniel","Joshua","Ruth","Praise","Favour","Kemi","Tobi"];
const NG_LAST = ["Okafor","Adeyemi","Balogun","Okoro","Eze","Abubakar","Nwosu","Oladipo","Afolabi","Chukwu","Bello","Ogunleye","Ibrahim","Adebayo","Obi","Nwachukwu","Lawal","Ojo","Uche","Danjuma","Ogundipe","Akinola","Oni","Mohammed","Ekpo"];
const INTL_FIRST = ["James","Sarah","Michael","Emily","David","Rachel","Peter","Hannah","Andrew","Grace","Daniel","Sophie","Joshua","Rebecca","Paul","Naomi","Mark","Esther","Simon","Ruth"];
const INTL_LAST = ["Smith","Jones","Williams","Brown","Taylor","Davies","Wilson","Evans","Thomas","Roberts","Johnson","Walker","Wright","Green","Hall","Clark","Adeyemi","Okonkwo","Mensah","Osei"];

export function personName(intl = false) {
  return intl
    ? `${choice(INTL_FIRST)} ${choice(INTL_LAST)}`
    : `${choice(NG_FIRST)} ${choice(NG_LAST)}`;
}
let phoneSeq = 7000000;
export function ngPhone() {
  phoneSeq += rndInt(1, 900);
  return `080${String(phoneSeq).padStart(8, "0").slice(-8)}`;
}
export const slugEmail = (name, i) =>
  `${name.toLowerCase().replace(/[^a-z]+/g, ".")}.${i}@example.com`;

// --- Batch insert helper (chunked multi-row) -------------------------------
export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ===========================================================================
// Baseline capture (idempotent) — records "the way it was" before seeding.
// ===========================================================================
export async function captureBaseline() {
  const exists = await sql`select to_regclass('public.mock_meta') as t`;
  if (exists[0].t) return; // already captured — keep the original baseline

  await sql`create table public.mock_meta (key text primary key, value text)`;
  await sql`create table public.mock_keep (table_name text, id text)`;
  await sql`create table public.mock_entity_prev (
    id uuid primary key, parent_entity_id uuid, functional_currency text,
    country text, legal_status text, statutory_jurisdiction text, is_active boolean)`;

  // Preserve tables that already hold rows we must not lose on reset.
  const preserve = [
    "entities", "accounts", "giving_types", "payroll_tax_rules",
    "partnership_tiers", "approval_chain_templates", "board_approval_triggers",
    "honorarium_approval_rules", "seeded_role_slots", "bank_accounts", "fx_rates",
    "user_entity_roles",
  ];
  for (const t of preserve) {
    await sql.unsafe(
      `insert into public.mock_keep (table_name, id) select '${t}', id::text from public.${t}`
    );
  }
  await sql`insert into public.mock_keep (table_name, id) select 'auth_users', id::text from auth.users`;

  // Snapshot every entity's current shape so reused/archived ones restore exactly.
  await sql`insert into public.mock_entity_prev
    select id, parent_entity_id, functional_currency, country,
           legal_status::text, statutory_jurisdiction, is_active from public.entities`;

  const [{ max }] = await sql`select coalesce(max(id),0) as max from public.audit_log`;
  await sql`insert into public.mock_meta values ('audit_high', ${String(max)}), ('seeded_at', now()::text)`;
  console.log("Baseline captured.");
}

// ===========================================================================
// Reset — restore to the captured baseline.
// ===========================================================================
const TRUNCATE_TABLES = [
  "journal_entry_lines", "journal_entries",
  "giving_records", "giver_identifiers", "giver_merge_candidates", "givers",
  "pledge_fulfillments", "pledges",
  "payroll_line_items", "payroll_runs", "compensation_components", "staff",
  "requisition_approvals", "requisition_batch_items", "requisition_batches", "requisition_requests",
  "disbursement_signatures", "disbursement_signature_slot_members", "disbursement_signature_slots", "disbursement_records",
  "honorarium_approvals", "honorarium_payments",
  "budget_lines", "budget_cycles", "entity_budget_settings",
  "restricted_fund_allowed_uses", "restricted_funds", "inter_fund_loans",
  "investment_maturity_alerts", "investments",
  "event_cost_sharing_splits", "event_cost_lines", "event_revenue_lines", "event_attribution_rules",
  "inventory_movements", "inventory_items", "event_details",
  "partnership_fulfillments", "partnership_lapse_flags", "partnership_commitments", "partners",
  "digital_product_sales", "digital_products",
  "reconciliation_matches", "bank_feed_transactions", "bank_feed_connections",
  "cash_deposits", "cash_count_sessions", "reconciliation_settings",
  "wht_remittance_log", "related_party_disclosures", "conflict_of_interest_registry",
  "whistleblower_reports", "scuml_compliance_log", "compliance_settings",
  "vendor_duplicate_flags", "vendors", "cross_border_transfers",
  "notifications", "email_outbox", "import_rows", "import_batches",
  "weekly_income_reports", "message_outbox",
  // Accounting-period layer (0023): counters and period rows regenerate on
  // demand; year-close records are demo actions. All safe to clear.
  "fiscal_periods", "fiscal_year_closes",
  // Phase 2/3 additions.
  "documents", "fixed_asset_depreciation", "fixed_assets", "online_payment_events",
  // Federated payroll (0037).
  "payroll_batch_signatures", "payroll_line_payments", "payroll_payment_batches",
  "payroll_adjustments",
];
// Deleted (not truncated) because they also hold baseline rows to preserve.
const DELETE_NOT_KEPT = ["bank_accounts", "fx_rates", "partnership_tiers", "payroll_tax_rules"];
const ENTITY_DELETE_ORDER = ["event", "campus", "sub_group", "ministry_expression", "ministry_directorate", "group"];

export async function reset() {
  const exists = await sql`select to_regclass('public.mock_meta') as t`;
  if (!exists[0].t) {
    console.log("No mock baseline found — nothing to reset.");
    return;
  }
  // Tables whose DELETE path must bypass user triggers (immutability/audit).
  const DISABLE = [...DELETE_NOT_KEPT, "entities", "user_entity_roles"];

  await sql.begin(async (tx) => {
    // Disable user triggers on delete targets (rolled back automatically on error).
    for (const t of DISABLE) await tx.unsafe(`alter table public.${t} disable trigger user`);

    // 1. Wipe transactional tables. TRUNCATE does NOT fire row DELETE triggers,
    //    so the ledger immutability guard does not block this admin reset.
    await tx.unsafe(`truncate table ${TRUNCATE_TABLES.map((t) => "public." + t).join(", ")} cascade`);
    // JE numbering counters restart with the emptied ledger (gapless from 1).
    await tx.unsafe(`truncate table app_private.je_counters`);

    // 2. Remove demo rows from preserve-tables that we also added to.
    for (const t of DELETE_NOT_KEPT) {
      await tx.unsafe(
        `delete from public.${t} where id::text not in (select id from public.mock_keep where table_name='${t}')`
      );
    }

    // 3. Demo role assignments, then demo entities (leaf-first), then demo users.
    await tx`delete from public.user_entity_roles
             where id::text not in (select id from public.mock_keep where table_name='user_entity_roles')`;
    for (const t of ENTITY_DELETE_ORDER) {
      await tx`delete from public.entities
               where type = ${t}::public.entity_type
                 and id::text not in (select id from public.mock_keep where table_name='entities')`;
    }

    // 4. Restore reused/archived entities to their pre-seed shape.
    await tx`update public.entities e set
               parent_entity_id = p.parent_entity_id,
               functional_currency = p.functional_currency,
               country = p.country,
               legal_status = p.legal_status::public.legal_status,
               statutory_jurisdiction = p.statutory_jurisdiction,
               is_active = p.is_active
             from public.mock_entity_prev p where p.id = e.id`;

    // 5. Demo auth users (+ identities).
    await tx`delete from auth.identities
             where user_id::text not in (select id from public.mock_keep where table_name='auth_users')`;
    await tx`delete from auth.users
             where id::text not in (select id from public.mock_keep where table_name='auth_users')`;

    // 6. Audit rows created during the demo.
    const [{ value: high }] = await tx`select value from public.mock_meta where key='audit_high'`;
    await tx`delete from public.audit_log where id > ${Number(high)}`;

    // 7. Re-enable triggers, then drop bookkeeping + helper functions.
    for (const t of DISABLE) await tx.unsafe(`alter table public.${t} enable trigger user`);
    await tx`drop function if exists public.mock_post_giving_batch(uuid[])`;
    await tx`drop table if exists public.mock_meta`;
    await tx`drop table if exists public.mock_keep`;
    await tx`drop table if exists public.mock_entity_prev`;
  });
  console.log("✅ Reset complete — database restored to its pre-seed baseline.");
}
