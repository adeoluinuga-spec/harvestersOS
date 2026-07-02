// Harvesters Finance OS — realistic mock/demo data seed.
// Fully reversible via scripts/mock/reset.mjs.
// Usage: node --env-file=.env.local scripts/mock/seed.mjs
import {
  sql, captureBaseline, FX_TO_NGN, rnd, rndInt, choice, chance, round2,
  lastMonths, iso, dayIn, personName, ngPhone, chunk,
} from "./lib.mjs";

const PASSWORD = "Test1234!";
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

const NG = { currency: "NGN", country: "NG" };
const ORG = [
  {
    name: "Group 1 — International Churches", pastor: "Dayo Ogunrombi", currency: "GBP", country: "GB",
    legal: "separate_foreign_entity",
    subgroups: [
      { name: "UK Subgroup", currency: "GBP", country: "GB", campuses: [
        ["Harvesters London", "GBP", "GB"], ["Harvesters Birmingham", "GBP", "GB"],
        ["Harvesters North London", "GBP", "GB"], ["Harvesters Kent", "GBP", "GB"],
        ["Harvesters Sheffield", "GBP", "GB"], ["Harvesters Manchester", "GBP", "GB"],
        ["Harvesters Norwich", "GBP", "GB"], ["Harvesters Glasgow", "GBP", "GB"] ] },
      { name: "US Subgroup", currency: "USD", country: "US", campuses: [
        ["Harvesters Houston", "USD", "US"], ["Harvesters Indiana", "USD", "US"],
        ["Harvesters New York", "USD", "US"], ["Harvesters Cranberry", "AUD", "AU"] ] },
    ],
  },
  {
    name: "Group 2 — Group Alpha", pastor: "Mayowa Agboade", currency: "NGN", country: "NG",
    legal: "incorporated_trustee",
    subgroups: [
      { name: "Gbagada Subgroup", ...NG, campuses: [
        ["Harvesters Gbagada", "NGN", "NG"], ["Harvesters Ikorodu", "NGN", "NG"],
        ["Harvesters Toronto", "CAD", "CA"], ["Harvesters Ikorodu North", "NGN", "NG"] ] },
      { name: "Magodo Subgroup", ...NG, campuses: [
        ["Harvesters Magodo", "NGN", "NG"], ["Harvesters Ilupeju", "NGN", "NG"],
        ["Harvesters Ogba", "NGN", "NG"], ["Harvesters New Lagos", "NGN", "NG"] ] },
      { name: "Jericho Subgroup", ...NG, campuses: [
        ["Harvesters Jericho", "NGN", "NG"], ["Harvesters Akobo", "NGN", "NG"],
        ["Harvesters Oluyole", "NGN", "NG"], ["Harvesters Port Harcourt", "NGN", "NG"],
        ["Harvesters Abeokuta", "NGN", "NG"], ["Harvesters FCT", "NGN", "NG"] ] },
      { name: "Yaba Subgroup", ...NG, campuses: [
        ["Harvesters Yaba", "NGN", "NG"], ["Harvesters Surulere", "NGN", "NG"],
        ["Harvesters Apapa", "NGN", "NG"], ["Prime Yaba", "NGN", "NG"] ] },
    ],
  },
  {
    name: "Group 3", pastor: "Soji Pitan", currency: "NGN", country: "NG", legal: "incorporated_trustee",
    subgroups: [
      { name: "Anthony Subgroup", ...NG, campuses: [
        ["Harvesters Anthony", "NGN", "NG"], ["Harvesters Ikoyi", "NGN", "NG"] ] },
      { name: "Alimosho Subgroup", ...NG, campuses: [
        ["Harvesters Alimosho", "NGN", "NG"], ["Harvesters Ipaja", "NGN", "NG"],
        ["Harvesters Abule Egba", "NGN", "NG"] ] },
    ],
  },
  {
    name: "Group 4", pastor: "Deji Lawal", currency: "NGN", country: "NG", legal: "incorporated_trustee",
    subgroups: [
      { name: "Globe Subgroup", ...NG, campuses: [
        ["Harvesters Globe", "NGN", "NG"], ["Harvesters Lekki", "NGN", "NG"],
        ["Harvesters Ajah", "NGN", "NG"], ["Harvesters Online Campus", "NGN", "NG"],
        ["Harvesters Abuja", "NGN", "NG"], ["Prime Abuja", "NGN", "NG"] ] },
    ],
  },
];

const FLAGSHIPS = new Set(["Harvesters London", "Harvesters Gbagada", "Harvesters Anthony", "Harvesters Globe"]);
const STATES = { default: "Lagos", "Harvesters Port Harcourt": "Rivers", "Harvesters Abeokuta": "Ogun",
  "Harvesters FCT": "FCT", "Harvesters Abuja": "FCT", "Prime Abuja": "FCT",
  "Harvesters Jericho": "Oyo", "Harvesters Akobo": "Oyo", "Harvesters Oluyole": "Oyo" };

let rootId, accounts = {}, entities = [], campuses = [], nlpId, adminId, cfoId;
const bank = {};
const giverByCampus = {};
const gtCache = {};
const errors = [];

async function safe(label, fn) {
  try { await fn(); log(`✓ ${label}`); }
  catch (e) { errors.push(`${label}: ${e.message}`); log(`✗ ${label}: ${e.message.split("\n")[0]}`); }
}
async function gtId(code) {
  if (!gtCache[code]) { const [r] = await sql`select id from public.giving_types where code=${code}`; gtCache[code] = r.id; }
  return gtCache[code];
}
function emailFor(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") + "@harvestersng.org";
}
async function ensureUser(email, fullName) {
  const mail = email.toLowerCase();
  const [ex] = await sql`select id from auth.users where lower(email)=${mail}`;
  if (ex) return ex.id;
  const [row] = await sql`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000'::uuid, gen_random_uuid(), 'authenticated','authenticated',
      ${mail}, extensions.crypt(${PASSWORD}, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', ${fullName}::text, 'mock_demo', true), now(), now(), '','','','')
    returning id`;
  await sql`insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (${row.id}::text, ${row.id}, jsonb_build_object('sub', ${row.id}::text, 'email', ${mail}::text), 'email', now(), now(), now())
    on conflict do nothing`;
  return row.id;
}
async function grant(userId, role, entityId = null) {
  await sql`insert into public.user_entity_roles (user_id, entity_id, role, granted_by)
    values (${userId}, ${entityId}, ${role}::public.app_role, ${userId}) on conflict do nothing`;
}
async function insEntity(type, parent, name, currency, country, legal) {
  const [r] = await sql`insert into public.entities (type, parent_entity_id, name, country, functional_currency, legal_status, is_active)
    values (${type}::public.entity_type, ${parent}, ${name}, ${country}, ${currency}, ${legal}::public.legal_status, true) returning id`;
  return r.id;
}
async function insMany(table, rows, cols) {
  const ids = [];
  for (const c of chunk(rows, 800)) {
    const got = await sql`insert into ${sql(table)} ${sql(c, ...cols)} returning id`;
    got.forEach((g) => ids.push(g.id));
  }
  return ids;
}
async function postJE(entity, date, description, source, lines, createdBy) {
  const [je] = await sql`insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
    values (${entity}, ${date}, ${description}, ${source}::public.source_module, ${createdBy}, 'draft') returning id`;
  const rows = lines.map((l) => ({ journal_entry_id: je.id, account_id: l.account, entity_id: entity,
    debit_amount: l.debit || 0, credit_amount: l.credit || 0, fund_classification: l.fund || "unrestricted", currency: l.currency }));
  await sql`insert into public.journal_entry_lines ${sql(rows, "journal_entry_id", "account_id", "entity_id", "debit_amount", "credit_amount", "fund_classification", "currency")}`;
  await sql`update public.journal_entries set status='posted' where id=${je.id}`;
  return je.id;
}
function giveSpec(giverId, campus, typeCode, amount, channel, date) {
  return { giver_id: giverId, entity_id: campus.id, recording_entity_id: campus.id, attribution_entity_id: campus.id,
    giving_type_id: null, _type: typeCode, amount, currency: campus.currency, channel, transaction_date: date, recorded_by: adminId };
}
async function fillTypes(rows) {
  for (const r of rows) { if (!r.giving_type_id) r.giving_type_id = await gtId(r._type); delete r._type; }
}

// ===========================================================================
async function run() {
  log("Capturing baseline…");
  await captureBaseline();
  await sql`create or replace function public.mock_post_giving_batch(p_ids uuid[]) returns void
    language plpgsql as $$ declare r uuid; begin foreach r in array p_ids loop perform public.post_giving_record(r); end loop; end $$`;

  const accs = await sql`select code, id from public.accounts`;
  accs.forEach((a) => (accounts[a.code] = a.id));
  const [root] = await sql`select id from public.entities where name='Harvesters International Christian Centre' and type='group' order by created_at limit 1`;
  rootId = root.id;
  adminId = await ensureUser("admin@harvestersng.org", "Harvesters OS Super Admin");
  cfoId = await ensureUser("cfo@harvestersng.org", "Group CFO");
  await grant(adminId, "super_admin");
  await grant(cfoId, "cfo_coo", rootId);

  await safe("archive placeholders", async () => {
    await sql`update public.entities set is_active=false where id <> ${rootId}`;
  });

  await safe("org tree + leaders", async () => {
    for (const g of ORG) {
      const gid = await insEntity("group", rootId, g.name, g.currency, g.country, g.legal);
      const pu = await ensureUser(emailFor(g.pastor), `Pastor ${g.pastor}`);
      await grant(pu, "group_pastor", gid);
      await grant(await ensureUser(emailFor(g.name + " accountant"), `${g.name} Accountant`), "group_finance_officer", gid);
      entities.push({ id: gid, name: g.name, type: "group", currency: g.currency });
      for (const sg of g.subgroups) {
        const sid = await insEntity("sub_group", gid, sg.name, sg.currency, sg.country, g.legal);
        entities.push({ id: sid, name: sg.name, type: "sub_group", currency: sg.currency });
        await grant(await ensureUser(emailFor(sg.name + " accountant"), `${sg.name} Accountant`), "sub_group_finance_officer", sid);
        for (const [cname, ccy, cc] of sg.campuses) {
          const cid = await insEntity("campus", sid, cname, ccy, cc, g.legal);
          const rec = { id: cid, name: cname, type: "campus", currency: ccy, country: cc, group: g.name, groupId: gid,
            subgroup: sg.name, tier: FLAGSHIPS.has(cname) ? "flagship" : choice(["large", "medium", "medium", "small"]),
            state: STATES[cname] || STATES.default };
          entities.push(rec); campuses.push(rec);
          await grant(await ensureUser(emailFor(cname + " admin"), `${cname} Administrator`), "campus_admin", cid);
          await grant(await ensureUser(emailFor(cname + " finance"), `${cname} Finance Officer`), "campus_finance_officer", cid);
        }
      }
    }
    const [existingNlp] = await sql`select id from public.entities where name='Next Level Prayers' limit 1`;
    nlpId = existingNlp ? existingNlp.id : await insEntity("ministry_directorate", rootId, "Next Level Prayers", "NGN", "NG", "unincorporated_unit");
    if (existingNlp) await sql`update public.entities set parent_entity_id=${rootId}, is_active=true, functional_currency='NGN' where id=${nlpId}`;
    await grant(await ensureUser("nlphead@harvestersng.org", "Next Level Prayers Director"), "ministry_lead", nlpId);
  });
  log(`Org: ${entities.length} entities (${campuses.length} campuses).`);

  await safe("fx rates", async () => {
    const rows = [];
    for (const ccy of ["GBP", "USD", "AUD", "CAD"]) for (const m of lastMonths(12))
      rows.push({ currency_pair: `${ccy}/NGN`, rate: round2(FX_TO_NGN[ccy] * rnd(0.94, 1.06)), effective_date: iso(m), source: "CBN", created_by: adminId });
    await sql`insert into public.fx_rates ${sql(rows, "currency_pair", "rate", "effective_date", "source", "created_by")}`;
  });

  await safe("bank accounts", async () => {
    for (const e of [...campuses, ...entities.filter((x) => x.type === "group")]) {
      const [op] = await sql`select public.create_bank_account(${e.id}, ${choice(["GTBank", "Zenith Bank", "Access Bank", "UBA", "First Bank", "Barclays UK", "Chase US"])}, ${String(rndInt(1000000000, 9999999999))}, 'operations', ${e.currency}) as id`;
      bank[e.id] = op.id;
      if (e.tier === "flagship" || e.type === "group")
        await sql`select public.create_bank_account(${e.id}, 'Building Fund Acct', ${String(rndInt(1000000000, 9999999999))}, 'building_fund', ${e.currency})`;
    }
  });

  await safe("givers + giving", async () => {
    const months = lastMonths(12);
    const giftIds = [];
    for (const c of campuses) {
      const intl = c.currency !== "NGN";
      const nGivers = c.tier === "flagship" ? rndInt(180, 260) : c.tier === "large" ? rndInt(110, 170) : c.tier === "medium" ? rndInt(50, 100) : rndInt(20, 45);
      const giverRows = Array.from({ length: nGivers }, () => {
        const name = personName(intl);
        return { full_name: name, phone: intl ? null : ngPhone(),
          email: chance(0.5) ? name.toLowerCase().replace(/[^a-z]+/g, ".") + `.${rndInt(1, 999)}@example.com` : null,
          primary_entity_id: c.id, is_active: true };
      });
      const giverIds = await insMany("givers", giverRows, ["full_name", "phone", "email", "primary_entity_id", "is_active"]);
      giverByCampus[c.id] = giverIds;
      const idRows = [];
      giverRows.forEach((g, i) => { if (g.phone) idRows.push({ giver_id: giverIds[i], identifier_type: "phone", identifier_value: g.phone.replace(/\D/g, "").slice(-10) }); });
      for (const ch of chunk(idRows, 800)) if (ch.length) await sql`insert into public.giver_identifiers ${sql(ch, "giver_id", "identifier_type", "identifier_value")} on conflict do nothing`;

      const scale = c.currency === "NGN" ? (c.tier === "flagship" ? 1 : c.tier === "large" ? 0.55 : c.tier === "medium" ? 0.28 : 0.1) : (c.tier === "flagship" ? 0.9 : 0.4);
      const rows = [];
      for (const m of months) {
        const d = iso(dayIn(m));
        const off = c.currency === "NGN" ? round2(rnd(18_000_000, 140_000_000) * scale) : round2(rnd(30_000, 320_000) * scale);
        rows.push(giveSpec(null, c, "offering", off, "cash", d));
        const nT = Math.round(giverIds.length * rnd(0.15, 0.35));
        for (let i = 0; i < nT; i++) {
          const amt = c.currency === "NGN" ? round2(rnd(30_000, 900_000) * (chance(0.05) ? 6 : 1)) : round2(rnd(150, 2500) * (chance(0.05) ? 5 : 1));
          rows.push(giveSpec(choice(giverIds), c, "tithe", amt, choice(["bank_transfer", "cash", "online_paystack", "pos"]), d));
        }
        rows.push(giveSpec(choice(giverIds), c, "seed", c.currency === "NGN" ? round2(rnd(2_000_000, 20_000_000) * scale) : round2(rnd(3_000, 40_000) * scale), "bank_transfer", d));
        if (chance(0.7)) rows.push(giveSpec(choice(giverIds), c, "building_fund", c.currency === "NGN" ? round2(rnd(3_000_000, 30_000_000) * scale) : round2(rnd(5_000, 60_000) * scale), "bank_transfer", d));
      }
      await fillTypes(rows);
      const grIds = await insMany("giving_records", rows,
        ["giver_id", "entity_id", "recording_entity_id", "attribution_entity_id", "giving_type_id", "amount", "currency", "channel", "transaction_date", "recorded_by"]);
      giftIds.push(...grIds);
    }
    log(`Posting ${giftIds.length} gifts to the ledger…`);
    for (const ch of chunk(giftIds, 1500)) await sql`select public.mock_post_giving_batch(${ch})`;
  });

  await seedPledges();
  await seedStaffPayroll();
  await seedBudgets();          // before expenses so requisitions can link to budget lines
  await seedVendorsExpenses();
  await seedFunds();
  await seedNlpEvents();
  await seedReconciliation();
  await seedGovernance();
  await seedWeeklyIncomeReports();
  await safe("derived alerts", async () => {
    await sql`select public.refresh_investment_maturity_alerts(120)`;
    await sql`select public.detect_lapsed_partners(current_date)`;
  });

  await coverage();
  if (errors.length) { console.log("\n⚠️  Module issues:"); errors.forEach((e) => console.log("  - " + e)); }
  log("Seed complete. Logins use password: " + PASSWORD);
}

async function seedPledges() {
  await safe("pledges", async () => {
    const bf = await gtId("building_fund");
    for (const c of campuses) {
      if (!chance(c.tier === "flagship" ? 0.9 : 0.4)) continue;
      const givers = giverByCampus[c.id] || [];
      const n = c.tier === "flagship" ? rndInt(6, 14) : rndInt(2, 6);
      for (let i = 0; i < n && givers.length; i++) {
        const giver = choice(givers);
        const total = c.currency === "NGN" ? round2(rnd(1_000_000, 25_000_000)) : round2(rnd(2_000, 40_000));
        const target = iso(new Date(new Date().getFullYear(), new Date().getMonth() + rndInt(-4, 6), 15));
        const [p] = await sql`insert into public.pledges (giver_id, entity_id, pledge_type, total_pledged_amount, currency, start_date, target_fulfillment_date, status)
          values (${giver}, ${c.id}, 'building_fund', ${total}, ${c.currency}, ${iso(new Date(new Date().getFullYear() - 1, 6, 1))}, ${target}, 'active') returning id`;
        if (chance(0.7)) {
          const paid = round2(total * rnd(0.2, 0.85));
          const [gr] = await sql`insert into public.giving_records (giver_id, entity_id, recording_entity_id, attribution_entity_id, giving_type_id, amount, currency, channel, transaction_date, recorded_by)
            values (${giver}, ${c.id}, ${c.id}, ${c.id}, ${bf}, ${paid}, ${c.currency}, 'bank_transfer', ${iso(dayIn(choice(lastMonths(6))))}, ${adminId}) returning id`;
          await sql`select public.post_giving_record(${gr.id})`;
          await sql`insert into public.pledge_fulfillments (pledge_id, giving_record_id, amount) values (${p.id}, ${gr.id}, ${paid})`;
        }
      }
    }
  });
}

async function seedStaffPayroll() {
  await safe("payroll tax rules", async () => {
    const rows = [];
    for (const st of ["Lagos", "Oyo", "Ogun", "Rivers", "FCT"]) for (const tp of ["minister_clergy", "administrative"])
      rows.push({ state_of_taxation: st, staff_type: tp, taxable_income_min: 0, taxable_income_max: 999999999,
        paye_rate: tp === "minister_clergy" ? 0.07 : 0.11, pension_rate: 0.08, nhf_rate: 0.025, relief_amount: 200000, effective_from: iso(new Date(2024, 0, 1)), is_active: true });
    await sql`insert into public.payroll_tax_rules ${sql(rows, "state_of_taxation", "staff_type", "taxable_income_min", "taxable_income_max", "paye_rate", "pension_rate", "nhf_rate", "relief_amount", "effective_from", "is_active")}`;
  });
  await safe("staff + compensation", async () => {
    for (const c of campuses) {
      const n = c.tier === "flagship" ? rndInt(8, 14) : c.tier === "large" ? rndInt(5, 9) : c.tier === "medium" ? rndInt(3, 6) : rndInt(2, 4);
      const specs = Array.from({ length: n }, () => {
        const type = chance(0.4) ? "minister_clergy" : "administrative";
        const base = c.currency === "NGN" ? round2(rnd(180000, 1200000) * (c.tier === "flagship" ? 1.6 : 1)) : round2(rnd(2200, 6500));
        return { type, base };
      });
      const staffRows = specs.map((s) => ({ entity_id: c.id, full_name: personName(c.currency !== "NGN"),
        staff_type: s.type, employment_status: "employed", state_of_taxation: c.state,
        pfa_provider: choice(["Stanbic IBTC", "ARM Pension", "Premium Pension"]), pension_id: "PEN" + rndInt(100000, 999999) }));
      const ids = await insMany("staff", staffRows, ["entity_id", "full_name", "staff_type", "employment_status", "state_of_taxation", "pfa_provider", "pension_id"]);
      const comps = [];
      ids.forEach((sid, i) => {
        const { type, base } = specs[i];
        comps.push({ staff_id: sid, component_type: "base_salary", amount: base, currency: c.currency, is_taxable: true });
        comps.push({ staff_id: sid, component_type: "housing_allowance", amount: round2(base * 0.3), currency: c.currency, is_taxable: type !== "minister_clergy" });
        comps.push({ staff_id: sid, component_type: "transport_allowance", amount: round2(base * 0.15), currency: c.currency, is_taxable: true });
      });
      for (const ch of chunk(comps, 800)) await sql`insert into public.compensation_components ${sql(ch, "staff_id", "component_type", "amount", "currency", "is_taxable")}`;
    }
  });
  await safe("payroll runs (6 months, NGN campuses)", async () => {
    for (const c of campuses.filter((x) => x.currency === "NGN")) {
      for (const m of lastMonths(6)) {
        try {
          const [r] = await sql`select public.create_payroll_run(${c.id}, ${m.getMonth() + 1}, ${m.getFullYear()}, ${adminId}) as id`;
          if (r?.id) await sql`select public.approve_payroll_run(${r.id}, ${cfoId})`;
        } catch { /* skip month */ }
      }
    }
  });
}

async function seedVendorsExpenses() {
  const vendors = [];
  await safe("vendors", async () => {
    for (const n of ["Zenith Prints Ltd", "Daystar Logistics", "GreenField Caterers", "SoundCity AV", "BuildRight Construction",
      "CleanPro Services", "PowerGen Diesel", "Grace Interiors", "SwiftMedia", "Anchor Security", "Bethel Supplies", "CityCabs"]) {
      const acct = String(rndInt(1000000000, 9999999999));
      const [v] = await sql`insert into public.vendors (name, bank_account_number_encrypted, bank_account_number_last4, tax_id, is_related_party)
        values (${n}, public.encrypt_account_number(${acct}), right(${acct}, 4), ${"TIN" + rndInt(10000, 99999)}, ${chance(0.15)}) returning id`;
      vendors.push(v.id);
    }
  });
  await safe("requisitions + disbursements + WHT", async () => {
    const expenseAccts = [accounts["5010"], accounts["6000"], accounts["5020"], accounts["5030"]];
    const cats = ["Facilities & Rent", "Utilities", "Welfare", "Missions & Outreach", "Media & Production"];
    // related-party vendor requisitions require a disclosure note (governance trigger); use non-related vendors here.
    const reqVendors = (await sql`select id from public.vendors where is_related_party=false`).map((v) => v.id);
    for (const c of campuses.filter((x) => x.currency === "NGN")) {
      const n = c.tier === "flagship" ? 6 : c.tier === "small" ? 2 : 4;
      for (let i = 0; i < n; i++) {
        const amount = round2(rnd(500_000, 40_000_000));
        const state = choice(["submitted", "in_approval", "approved", "disbursed", "disbursed", "rejected"]);
        const whtApplicable = chance(0.6);
        const whtRate = whtApplicable ? 5 : 0; // percent
        const wht = round2((amount * whtRate) / 100);
        const dt = iso(dayIn(choice(lastMonths(3))));
        const [req] = await sql`insert into public.requisition_requests
          (entity_id, raised_by, raised_by_role, org_branch, raised_by_level, vendor_id, category, description, amount, currency,
           needed_by_date, is_urgent, wht_applicable, wht_rate, status, submitted_at, budget_line_id)
          values (${c.id}, ${adminId}, 'campus_finance_officer', 'congregational', 'campus', ${choice(reqVendors)}, ${choice(cats)},
           ${"Requisition — " + choice(cats)}, ${amount}, ${c.currency}, ${dt}, ${chance(0.2)},
           ${whtApplicable}, ${whtRate}, ${state}::public.requisition_status, ${dt},
           (select bl.id from public.budget_lines bl join public.accounts a on a.id=bl.account_id
            where bl.entity_id=${c.id} and a.account_type='expense' order by random() limit 1)) returning id`;
        try { await sql`select public.generate_requisition_approvals(null, ${req.id})`; } catch { /* ok */ }
        if (state === "approved" || state === "disbursed")
          await sql`update public.requisition_approvals set status='approved', decided_at=now(), approver_user_id=${cfoId} where requisition_request_id=${req.id}`;
        if (state === "disbursed") {
          const dd = iso(dayIn(choice(lastMonths(2))));
          const [d] = await sql`insert into public.disbursement_records
            (requisition_request_id, bank_account_id, finance_processed_by, bank_upload_reference, transfer_instruction_reference,
             gross_amount, wht_withheld_amount, net_payable_amount, disbursement_status, disbursed_at)
            values (${req.id}, ${bank[c.id] || null}, ${cfoId}, ${"UPL-" + rndInt(1000, 9999)}, ${"TRF-" + rndInt(1000, 9999)},
             ${amount}, ${wht}, ${round2(amount - wht)}, 'disbursed', ${dd}) returning id`;
          const lines = [{ account: choice(expenseAccts), debit: amount, currency: c.currency }];
          if (wht > 0) lines.push({ account: accounts["2000"], credit: wht, currency: c.currency });
          lines.push({ account: accounts["1010"], credit: round2(amount - wht), currency: c.currency });
          const je = await postJE(c.id, dd, "Expense disbursement", "expense", lines, adminId);
          await sql`update public.disbursement_records set journal_entry_id=${je} where id=${d.id}`;
          if (wht > 0)
            await sql`insert into public.wht_remittance_log (requisition_request_id, disbursement_record_id, entity_id, entity_state, remittance_month, withheld_amount, remitted_amount, status)
              values (${req.id}, ${d.id}, ${c.id}, ${c.state}, ${iso(new Date(new Date().getFullYear(), new Date().getMonth() - rndInt(0, 3), 1))}, ${wht}, ${chance(0.5) ? wht : 0}, ${chance(0.5) ? "remitted" : "owed"})`;
        }
      }
    }
  });
}

async function seedBudgets() {
  await safe("budget cycle + lines", async () => {
    const [cyc] = await sql`insert into public.budget_cycles (fiscal_year, status) values (${new Date().getFullYear()}, 'approved') returning id`;
    const codes = ["4000", "4010", "4020", "5000", "5010", "6000", "5020"];
    const rows = [];
    for (const c of campuses) {
      for (const code of codes) {
        const base = c.currency === "NGN" ? rnd(20_000_000, 300_000_000) : rnd(30_000, 400_000);
        const proposed = round2(base * (c.tier === "flagship" ? 2 : c.tier === "small" ? 0.3 : 1));
        rows.push({ budget_cycle_id: cyc.id, entity_id: c.id, account_id: accounts[code], proposed_amount: proposed,
          approved_amount: round2(proposed * rnd(0.85, 1.05)), submitted_by: adminId, reviewed_by: cfoId, notes: "FY plan", submitted_at: new Date(), reviewed_at: new Date() });
      }
      await sql`insert into public.entity_budget_settings (entity_id, enforcement_mode) values (${c.id}, ${choice(["warn", "warn", "block", "none"])}::public.budget_enforcement_mode) on conflict (entity_id) do nothing`;
    }
    for (const ch of chunk(rows, 800)) await sql`insert into public.budget_lines ${sql(ch, "budget_cycle_id", "entity_id", "account_id", "proposed_amount", "approved_amount", "submitted_by", "reviewed_by", "notes", "submitted_at", "reviewed_at")}`;
  });
}

async function seedFunds() {
  await safe("restricted funds + investments", async () => {
    for (const e of entities.filter((x) => x.type === "group" || FLAGSHIPS.has(x.name))) {
      const cur = e.currency || "NGN";
      const [f] = await sql`insert into public.restricted_funds (entity_id, name, fund_classification, target_amount, purpose_description, is_active)
        values (${e.id}, 'Building Project Fund', 'temporarily_restricted', ${cur === "NGN" ? 5_000_000_000 : 5_000_000}, 'New auditorium construction', true) returning id`;
      await sql`insert into public.restricted_fund_allowed_uses (restricted_fund_id, account_id) values (${f.id}, ${accounts["5010"]}), (${f.id}, ${accounts["1020"]}) on conflict do nothing`;
      // Fund designation entries (equity move: unrestricted 3000 -> restricted 3100)
      // give the fund a realistic balance without inflating giving/income.
      const target = cur === "NGN" ? 5_000_000_000 : 5_000_000;
      const perC = round2((target * rnd(0.4, 0.85)) / 4);
      for (let k = 0; k < 4; k++)
        await postJE(e.id, iso(dayIn(choice(lastMonths(9)))), "Restricted fund designation", "adjustment",
          [{ account: accounts["3000"], debit: perC, currency: cur, fund: "unrestricted" },
           { account: accounts["3100"], credit: perC, currency: cur, fund: "temporarily_restricted" }], adminId);
      if (chance(0.6))
        await sql`insert into public.investments (entity_id, investment_type, institution, principal_amount, currency, interest_rate, start_date, maturity_date, status, created_by)
          values (${e.id}, 'fixed_deposit', ${choice(["Zenith Bank", "GTBank", "Stanbic IBTC"])}, ${cur === "NGN" ? round2(rnd(100_000_000, 2_000_000_000)) : round2(rnd(200_000, 3_000_000))}, ${cur}, ${round2(rnd(8, 19))},
           ${iso(new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1))}, ${iso(new Date(new Date().getFullYear(), new Date().getMonth() + rndInt(1, 6), 1))}, 'active', ${adminId})`;
    }
    const g2 = entities.find((x) => x.name === "Group 2 — Group Alpha");
    if (g2) await sql`insert into public.inter_fund_loans (lending_entity_id, borrowing_entity_id, borrowing_purpose, principal_amount, currency, date_issued, status, created_by)
      values (${rootId}, ${g2.id}, 'Bridge finance for auditorium', 300000000, 'NGN', ${iso(new Date(new Date().getFullYear(), 1, 1))}, 'active', ${adminId})`;
  });
}

async function seedNlpEvents() {
  await safe("NLP partnerships", async () => {
    const tierIds = [];
    for (const [name, mn, mx] of [["Bronze", 5000, 20000], ["Silver", 20000, 100000], ["Gold", 100000, 500000], ["Platinum", 500000, 5000000]]) {
      const [t] = await sql`insert into public.partnership_tiers (entity_id, name, min_monthly_amount, max_monthly_amount, currency, sort_order, is_active)
        values (${nlpId}, ${name}, ${mn}, ${mx}, 'NGN', ${tierIds.length}, true) returning id`;
      tierIds.push(t.id);
    }
    const pool = Object.values(giverByCampus).flat();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const partnerCount = Math.min(150, Math.floor(pool.length * 0.08));
    const months = lastMonths(6);
    for (let i = 0; i < partnerCount; i++) {
      const [pr] = await sql`insert into public.partners (giver_id, entity_id, partnership_tier_id, start_date, status)
        values (${pool[i]}, ${nlpId}, ${choice(tierIds)}, ${iso(new Date(new Date().getFullYear() - 1, rndInt(0, 11), 1))}, 'active') returning id`;
      const monthly = choice([10000, 25000, 50000, 100000, 250000]);
      const [cm] = await sql`insert into public.partnership_commitments (partner_id, committed_monthly_amount, currency, start_month, expected_day, is_active)
        values (${pr.id}, ${monthly}, 'NGN', ${iso(months[0])}, ${rndInt(1, 28)}, true) returning id`;
      const payMonths = chance(0.15) ? months.slice(0, months.length - rndInt(2, 4)) : months.filter(() => chance(0.85));
      for (const m of payMonths) {
        try { await sql`select public.record_partnership_payment(${cm.id}, ${monthly}, 'NGN', 'bank_transfer', ${iso(dayIn(m))}, ${adminId}, 'Monthly partnership')`; } catch { /* ok */ }
      }
    }
  });
  await safe("prayer conferences", async () => {
    const conf = async (name, host, costTotal, revTotal, cur, country) => {
      const start = iso(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 12));
      const end = iso(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 15));
      // each event is its own 'event' entity (event_details.entity_id is unique)
      const [ee] = await sql`insert into public.entities (type, parent_entity_id, name, country, functional_currency, legal_status, is_active, start_date, end_date)
        values ('event', ${nlpId}, ${name}, ${country}, ${cur}, 'unincorporated_unit', true, ${start}, ${end}) returning id`;
      const [ev] = await sql`insert into public.event_details (entity_id, event_name, event_type, hosting_entity_id, start_date, end_date, attendee_count, status)
        values (${ee.id}, ${name}, 'prayer_conference', ${host}, ${start}, ${end}, ${rndInt(8000, 60000)}, 'closed') returning id`;
      let rleft = revTotal;
      for (const rt of ["ticket_sales", "sponsorships", "offerings", "merchandise"]) {
        const amt = round2(rt === "offerings" ? revTotal * 0.5 : rleft * rnd(0.15, 0.3)); rleft -= amt;
        await sql`insert into public.event_revenue_lines (event_detail_id, revenue_type, amount, currency, description, received_at, created_by)
          values (${ev.id}, ${rt}::public.event_revenue_type, ${amt}, ${cur}, ${rt}, ${end}, ${adminId})`;
      }
      for (const [ct, w] of [["venue", 0.35], ["logistics", 0.2], ["production_simulcast", 0.2], ["hospitality_accommodation", 0.15], ["speaker_honorarium", 0.1]])
        await sql`insert into public.event_cost_lines (event_detail_id, cost_type, amount, currency, description, incurred_at, created_by)
          values (${ev.id}, ${ct}::public.event_cost_type, ${round2(costTotal * w)}, ${cur}, ${ct}, ${end}, ${adminId})`;
      await sql`insert into public.event_attribution_rules (event_detail_id, policy, host_entity_percentage, giver_home_entity_percentage) values (${ev.id}, 'split', 60, 40)`;
    };
    const london = entities.find((x) => x.name === "Harvesters London");
    const gbagada = entities.find((x) => x.name === "Harvesters Gbagada");
    await conf("Next Level Global Prayer Conference — London", london?.id || nlpId, 1_200_000, 900_000, "GBP", "GB");
    await conf("Next Level Prayer Conference — Nigeria", gbagada?.id || nlpId, 2_500_000_000, 1_800_000_000, "NGN", "NG");
  });
  await safe("digital products", async () => {
    const [dp] = await sql`insert into public.digital_products (entity_id, name, product_type, access_period_days, price_amount, currency, deferred_revenue_account_id, revenue_account_id, is_active)
      values (${nlpId}, '40 Days Devotional', 'devotional', 40, 5000, 'NGN', ${accounts["2100"]}, ${accounts["4040"]}, true) returning id`;
    const pool = Object.values(giverByCampus).flat();
    for (let i = 0; i < 200 && pool.length; i++) {
      const sd = dayIn(choice(lastMonths(3))); const ed = new Date(sd); ed.setDate(ed.getDate() + 40);
      await sql`insert into public.digital_product_sales (digital_product_id, giver_id, sale_date, amount, currency, access_start_date, access_end_date, status, created_by)
        values (${dp.id}, ${choice(pool)}, ${iso(sd)}, 5000, 'NGN', ${iso(sd)}, ${iso(ed)}, 'active', ${adminId})`;
    }
  });
  await safe("honorariums", async () => {
    for (let i = 0; i < 12; i++) {
      const c = choice(campuses.filter((x) => x.currency === "NGN"));
      const amt = round2(rnd(200_000, 5_000_000));
      const [h] = await sql`insert into public.honorarium_payments (entity_id, recipient_name, recipient_type, amount, currency, wht_applicable, wht_amount, payment_date, status, created_by)
        values (${c.id}, ${personName()}, ${choice(["guest_minister", "visiting_speaker"])}::public.honorarium_recipient_type, ${amt}, 'NGN', true, ${round2(amt * 0.05)}, ${iso(dayIn(choice(lastMonths(4))))}, 'draft', ${adminId}) returning id`;
      try {
        await sql`select public.generate_honorarium_approvals(${h.id})`;
        if (chance(0.6)) {
          await sql`update public.honorarium_approvals set status='approved', decided_at=now(), approver_user_id=${cfoId} where honorarium_payment_id=${h.id}`;
          await sql`select public.post_honorarium_payment(${h.id}, ${cfoId})`;
        }
      } catch { /* ok */ }
    }
  });
}

async function seedReconciliation() {
  await safe("bank feed + matching", async () => {
    for (const c of campuses.filter((x) => x.currency === "NGN").slice(0, 12)) {
      const ba = bank[c.id]; if (!ba) continue;
      await sql`insert into public.bank_feed_connections (bank_account_id, provider, external_account_id, is_active, created_by)
        values (${ba}, 'mono', ${"acct-" + rndInt(1000, 9999)}, true, ${adminId})`;
      const lines = await sql`select l.credit_amount amt, e.transaction_date d from public.journal_entry_lines l
        join public.journal_entries e on e.id=l.journal_entry_id
        where e.entity_id=${c.id} and e.source_module='giving' and l.credit_amount>0 order by e.transaction_date desc limit 15`;
      for (const ln of lines) if (chance(0.7)) await sql`select public.ingest_bank_feed_transaction(${ba}, 'mono'::public.bank_feed_provider, ${"tx-" + rndInt(100000, 999999)}, ${iso(new Date(ln.d))}::date, ${ln.amt}, ${c.currency}, 'Credit transfer')`;
      await sql`select public.ingest_bank_feed_transaction(${ba}, 'mono'::public.bank_feed_provider, ${"tx-" + rndInt(100000, 999999)}, ${iso(dayIn(choice(lastMonths(2))))}::date, ${round2(rnd(50000, 500000))}, ${c.currency}, 'Unidentified lodgement')`;
      try { await sql`select public.auto_match_bank_feed(${ba})`; } catch { /* ok */ }
    }
  });
  await safe("cash counts + deposits", async () => {
    for (const c of campuses.filter((x) => x.currency === "NGN").slice(0, 20)) {
      const ba = bank[c.id];
      const counted = round2(rnd(2_000_000, 40_000_000));
      const [cs] = await sql`insert into public.cash_count_sessions (entity_id, service_date, counted_by, total_counted, currency, sealed_bag_reference, status, created_by)
        values (${c.id}, ${iso(dayIn(choice(lastMonths(2))))}, ARRAY[${adminId}::uuid, ${cfoId}::uuid], ${counted}, ${c.currency}, ${"BAG-" + rndInt(1000, 9999)}, 'finalized', ${adminId}) returning id`;
      if (ba) {
        const variance = chance(0.2) ? round2(rnd(-50000, -1000)) : 0;
        await sql`insert into public.cash_deposits (cash_count_session_id, deposited_amount, bank_account_id, deposit_date, deposit_slip_reference, variance, variance_status, created_by)
          values (${cs.id}, ${round2(counted + variance)}, ${ba}, ${iso(dayIn(choice(lastMonths(2))))}, ${"SLIP-" + rndInt(1000, 9999)}, ${variance}, ${variance !== 0 ? "flagged" : "clean"}, ${adminId})`;
      }
    }
  });
}

async function seedGovernance() {
  await safe("governance records", async () => {
    for (const g of entities.filter((x) => x.type === "group")) {
      await sql`insert into public.scuml_compliance_log (entity_id, registration_status, registration_number, registration_date, last_filing_date, next_filing_due_date, reviewed_by)
        values (${g.id}, ${choice(["registered", "filing_due", "registered"])}::public.scuml_status, ${"SCUML-" + rndInt(10000, 99999)}, ${iso(new Date(2022, 2, 1))}, ${iso(new Date(new Date().getFullYear(), 0, 31))}, ${iso(new Date(new Date().getFullYear() + 1, 0, 31))}, ${cfoId})`;
      await sql`insert into public.compliance_settings (entity_id, nfiu_cash_threshold, wht_overdue_days) values (${g.id}, 5000000, 21) on conflict (entity_id) do nothing`;
    }
    const [rp] = await sql`select id from public.vendors where is_related_party=true limit 1`;
    if (rp) await sql`insert into public.related_party_disclosures (vendor_id, entity_id, disclosure_note, status)
      values (${rp.id}, ${rootId}, 'Vendor associated with a board trustee; disclosed and approved at higher tier.', 'reviewed')`;
    const [coiStaff] = await sql`select id from public.staff limit 1`;
    if (coiStaff) await sql`insert into public.conflict_of_interest_registry (staff_id, declared_interest, date_declared, status) values (${coiStaff.id}, 'Staff member holds a directorship in a supplier company.', ${iso(new Date(new Date().getFullYear(), 0, 15))}, 'reviewed')`;
    await sql`insert into public.whistleblower_reports (is_anonymous, category, description, status, received_at)
      values (true, 'financial_misconduct', 'Concern raised about unapproved cash handling at a campus service.', 'under_review', now())`;
  });
}

async function seedWeeklyIncomeReports() {
  await safe("weekly income reports", async () => {
    const now = new Date();
    const diffToMonday = (now.getDay() + 6) % 7;
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - diffToMonday);
    const weekStart = new Date(thisMonday);
    weekStart.setDate(thisMonday.getDate() - 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const ws = iso(weekStart);
    const we = iso(weekEnd);
    const year = weekStart.getFullYear();
    for (const c of campuses.slice(0, 18)) {
      const [weekly] = await sql`
        select coalesce(sum(round(gr.amount * public.fx_rate_at(gr.currency::text,'NGN',gr.transaction_date),2)),0) amount_ngn,
               count(*)::int gifts,
               count(distinct gr.giver_id)::int givers
        from public.giving_records gr
        where gr.entity_id=${c.id} and gr.transaction_date between ${ws}::date and ${we}::date`;
      const [target] = await sql`
        select coalesce(sum(bl.approved_amount * public.fx_rate_at(e.functional_currency::text,'NGN',make_date(bc.fiscal_year,1,1))),0) target_ngn
        from public.budget_lines bl
        join public.budget_cycles bc on bc.id=bl.budget_cycle_id
        join public.accounts a on a.id=bl.account_id
        join public.entities e on e.id=bl.entity_id
        where bl.entity_id=${c.id} and bc.fiscal_year=${year} and a.account_type='income'`;
      const [ytd] = await sql`
        select coalesce(sum(round(gr.amount * public.fx_rate_at(gr.currency::text,'NGN',gr.transaction_date),2)),0) achieved_ngn
        from public.giving_records gr
        where gr.entity_id=${c.id} and gr.transaction_date between make_date(${year},1,1) and ${we}::date`;
      const weeklyAmount = Number(weekly.amount_ngn || 0);
      const targetAmount = Number(target.target_ngn || 0);
      const achieved = Number(ytd.achieved_ngn || 0);
      const data = {
        campus: { id: c.id, name: c.name, currency: c.currency },
        period: { week_start: ws, week_end: we, fiscal_year: year },
        weekly: [],
        month_weeks: [{ week_start: ws, week_end: we, amount_ngn: weeklyAmount, gift_count: Number(weekly.gifts || 0) }],
        target: {
          annual_target_ngn: targetAmount,
          target_to_date_ngn: Math.round(targetAmount * 0.5),
          achieved_ytd_ngn: achieved,
          achieved_percent: targetAmount ? Math.round((achieved / targetAmount) * 10000) / 100 : 0,
          pace_percent: targetAmount ? Math.round((achieved / (targetAmount * 0.5)) * 10000) / 100 : 0,
        },
        totals: { weekly_ngn: weeklyAmount, gift_count: Number(weekly.gifts || 0), giver_count: Number(weekly.givers || 0) },
      };
      await sql`
        insert into public.weekly_income_reports
          (entity_id, week_start, week_end, generated_data, ai_narrative, ai_analysis, generated_by, sent_by, sent_at, recipients)
        values
          (${c.id}, ${ws}::date, ${we}::date, ${JSON.stringify(data)}::jsonb,
           ${`${c.name} recorded NGN ${Math.round(weeklyAmount).toLocaleString("en-NG")} for the week, across ${weekly.gifts || 0} gifts.`},
           ${`This is a pastoral and strategic review point. Compare giving participation with attendance, thank consistent givers, and follow up where giving velocity has slowed.`},
           ${adminId}, ${cfoId}, now(), ARRAY[${adminId}::uuid, ${cfoId}::uuid])
        on conflict (entity_id, week_start) do nothing`;
    }
  });
}

async function coverage() {
  const tables = ["entities", "givers", "giving_records", "journal_entries", "journal_entry_lines",
    "pledges", "pledge_fulfillments", "staff", "payroll_runs", "payroll_line_items", "vendors",
    "requisition_requests", "disbursement_records", "wht_remittance_log", "budget_lines", "restricted_funds",
    "investments", "partners", "partnership_commitments", "partnership_fulfillments", "event_details",
    "event_revenue_lines", "event_cost_lines", "digital_product_sales", "honorarium_payments",
    "bank_feed_transactions", "reconciliation_matches", "cash_count_sessions", "cash_deposits",
    "scuml_compliance_log", "whistleblower_reports", "fx_rates", "bank_accounts"];
  tables.push("weekly_income_reports");
  console.log("\n=== COVERAGE (rows) ===");
  for (const t of tables) { const [{ n }] = await sql.unsafe(`select count(*)::int n from public.${t}`); console.log(`  ${t.padEnd(28)} ${n}`); }
}

try {
  await run();
} catch (e) {
  console.error("FATAL:", e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
