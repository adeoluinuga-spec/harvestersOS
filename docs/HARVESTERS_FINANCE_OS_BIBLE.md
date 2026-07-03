# Harvesters Finance OS — The Complete Reference ("The Bible")

> A single, storable reference explaining everything the platform is, how it is
> built, and everything it can do. Written for church leadership, finance staff,
> auditors, and future engineers.

**Organisation:** Harvesters International Christian Centre
**Type:** Ledger‑grade financial operating system
**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind · Supabase (PostgreSQL 17)
**Repository:** `harvestersOS` · **Brand:** black / white / silver · Futura + Montserrat

---

## Table of Contents

1. [The Founding Principle](#1-the-founding-principle)
2. [Architecture & How It Fits Together](#2-architecture--how-it-fits-together)
3. [The Ledger — The Heart of Everything](#3-the-ledger--the-heart-of-everything)
4. [The Organisation Model (Entities)](#4-the-organisation-model-entities)
5. [People, Roles & Permissions](#5-people-roles--permissions)
6. [Segregation of Duties](#6-segregation-of-duties)
7. [The Audit Backbone](#7-the-audit-backbone)
8. [Money, Currencies & Consolidation](#8-money-currencies--consolidation)
9. [The Modules — What The Platform Does](#9-the-modules--what-the-platform-does)
10. [Spreadsheet Imports](#10-spreadsheet-imports)
11. [Bulk Management at Scale](#11-bulk-management-at-scale)
12. [Reporting & Analytics](#12-reporting--analytics)
13. [Security Model](#13-security-model)
14. [The Demo / Presentation Dataset](#14-the-demo--presentation-dataset)
15. [Operations & Maintenance](#15-operations--maintenance)
16. [Known Limitations & Production Hardening](#16-known-limitations--production-hardening)
17. [What Each Role Can Do](#17-what-each-role-can-do)
18. [Glossary](#18-glossary)

---

## 1. The Founding Principle

Every financial module in Harvesters Finance OS sits on top of **one immutable,
append‑only, double‑entry ledger**. This is the single rule that makes the whole
system trustworthy:

- **Double‑entry:** every transaction has a debit side and a credit side, and
  they must **balance** before it can be posted.
- **Immutable / append‑only:** once a transaction is *posted*, it can **never**
  be edited or deleted. Corrections happen only through **reversing entries**.
- **Derived balances:** account and fund balances are always *computed from* the
  ledger — never stored and edited directly. No module keeps a "parallel" balance.

**Why this matters:** because nothing is ever silently changed or deleted, the
system can answer "who changed what, when, and why" at any time. Audit,
compliance, tax filing, and board reporting are possible *without a rebuild* —
they are simply different views over the same permanent record.

This principle is **enforced by the database itself** (triggers), not by
application code. Even a developer with direct database access cannot alter a
posted transaction through normal operations.

---

## 2. Architecture & How It Fits Together

```
                        ┌──────────────────────────────┐
   Browser (staff)  →   │  Next.js App (App Router)     │
                        │  • Server Components (pages)  │
                        │  • Server Actions (writes)    │
                        │  • Middleware (auth gate)     │
                        └───────────────┬──────────────┘
                                        │ server-side only
                       ┌────────────────┴─────────────────┐
                       │                                  │
             Supabase Auth (login,                Direct Postgres
             sessions, JWT)                        (owner role)
                       │                                  │
                       └──────────────┬───────────────────┘
                                      ▼
                        ┌──────────────────────────────┐
                        │  PostgreSQL 17 (Supabase)     │
                        │  • Immutable ledger           │
                        │  • RLS on every table         │
                        │  • Triggers enforce integrity │
                        │  • Vault (encryption keys)    │
                        └──────────────────────────────┘
```

**Key architectural decisions:**

- **The database is the source of truth and the last line of defence.** Business
  rules that must never be violated (balance, immutability, segregation of
  duties, fund restrictions, WHT calculation) are enforced by **triggers and
  functions in Postgres**, so they hold no matter what calls the database.
- **Writes go through the server.** The browser never holds privileged keys.
  Pages read and actions write through Next.js server code using a trusted
  connection; the actor's identity is threaded through so every write is audited.
- **Row Level Security (RLS) is enabled on every table** as defence‑in‑depth for
  any direct client access.
- **Migrations** describe the entire schema and live in `supabase/migrations`
  (numbered `0001`…`0020`). The database can be rebuilt from them.

---

## 3. The Ledger — The Heart of Everything

### Structure

- **`journal_entries`** — one per transaction: which entity, the date, a
  description, the source module (giving / expense / payroll / transfer /
  adjustment / opening_balance / reversal / honorarium), who created it, who
  approved it, and its status (`draft` → `posted` → `reversed`).
- **`journal_entry_lines`** — the debit/credit lines. Each line ties an
  **account** to a specific **entity**, carries an amount, a currency, a fund
  classification, and the FX rate to presentation currency.

### The guarantees (enforced by triggers)

1. **Balance before posting.** An entry cannot become `posted` unless its debit
   and credit totals are equal (in presentation currency, so multi‑currency
   entries balance correctly).
2. **Immutability of posted rows.** Posted entries and their lines can never be
   `UPDATE`d or `DELETE`d. The only permitted change to a posted entry is the
   single transition `posted → reversed`.
3. **Corrections are reversing entries.** To undo a posted entry, the system
   creates a **new** balanced entry that flips the debits and credits, links back
   to the original, and marks the original `reversed`. The original always
   remains visible.
4. **Triggers fire for everyone**, including privileged/server code — the only
   way to bulk‑clear the ledger is `TRUNCATE` (used solely by the admin demo
   reset), which is deliberately outside normal operations.

### How modules use it

Every financial module **posts to this ledger** — it never writes a separate
balance. For example, recording a gift creates a balanced journal entry (debit
cash/bank, credit the giving type's income account). Because every campus posts
at the leaf, **group, sub‑group, and consolidated views are derived** by rolling
up the ledger through the entity hierarchy.

---

## 4. The Organisation Model (Entities)

The org is modelled as a **polymorphic hierarchy** in the `entities` table, not a
rigid three levels. An entity can be:

- **`group`** — a top‑level or regional group (arbitrary nesting allowed).
- **`sub_group`** — a cluster of campuses.
- **`campus`** — a local church.
- **`ministry_directorate` / `ministry_expression`** — parallel ministry nodes
  (e.g. Next Level Prayers) that sit alongside the congregational tree.
- **`event`** — a temporary entity with a start/end date, used as a cost centre
  for conferences and programmes.

Each entity has a **functional currency**, a country, a **legal status**
(incorporated trustee / separate foreign entity / unincorporated unit), and a
statutory jurisdiction. `parent_entity_id` builds the tree to any depth.

**Why polymorphic:** it supports the real Harvesters shape — Groups → Sub‑Groups
→ Campuses of varying depth, international campuses in their own currencies, a
Ministry Directorate that spans the whole org, and temporary events — all in one
consistent structure that reports and permissions understand automatically.

---

## 5. People, Roles & Permissions

### Authentication
Supabase Auth handles login/sessions. Middleware guards every route: an
unauthenticated visitor is redirected to `/login`; a signed‑in user is scoped to
what their roles allow.

### Roles (the `app_role` set)
`super_admin`, `cfo_coo`, `global_lead_pastor`, `group_pastor`,
`group_finance_officer`, `sub_group_pastor`, `sub_group_finance_officer`,
`campus_pastor`, `campus_finance_officer`, `campus_admin`,
`campus_data_entry_clerk`, `ministry_lead`, `ministry_director`,
`head_of_expression`, `event_finance_lead`, `finance_processor`,
`bank_signatory`, `board_trustee`, `governance_officer`, `auditor`.

### The scoping rule
A user's role is granted **on one or more specific entities**, stored in
`user_entity_roles(user_id, entity_id, role, granted_by, granted_at)`. Access
**cascades down the tree**: a sub‑group finance officer automatically sees all
campuses under that sub‑group. `super_admin` and `auditor` are **global** (a
check constraint enforces that these are the only entity‑less roles).

This means a campus finance officer for Campus A **cannot** see or act on Campus
B unless explicitly granted. The whole model is computed by the database function
`accessible_entity_ids(user)`, which every page and report uses to scope data.

### Admin
`super_admin`s manage users↔entity↔role assignments in **Admin → Access & Roles**,
and manage the entity tree and chart of accounts in **Admin → Entities /
Accounts**.

---

## 6. Segregation of Duties

The person who **creates/records** a transaction cannot be the same person who
**approves/posts** it. This is enforced in two layers:

1. **Application layer** — before an approval action, the app checks the actor is
   not the creator; if they are, it **durably logs the attempt** (a committed
   `sod_violation` audit record) and refuses.
2. **Database backstop** — the posting function itself rejects `approver = creator`
   even if the application check were somehow bypassed.

This applies to the approval workflows (expenses, payroll, honorariums). Recorded
income (giving) is a system posting, not a peer approval, so it is not subject to
the creator≠approver rule.

---

## 7. The Audit Backbone

Every create/update/approve/reject/reverse/delete on **every** table is captured
automatically by a single reusable trigger (`app_private.tg_audit`). Each audit
record stores: **who** (actor), **when** (timestamp), **which entity**, the
**action**, the **table & record**, and a **before/after JSON snapshot**.

- Modules never have to "remember" to log — it is automatic and uniform.
- The actor is resolved from the authenticated session (or the server‑set actor
  context for server writes), so audit is accurate even for backend operations.
- Audit is **append‑only** and visible only to `super_admin` and compliance
  roles. The Governance module provides a filterable **audit log viewer** with
  CSV export and print/PDF output — the backbone of compliance reporting.

---

## 8. Money, Currencies & Consolidation

- Every entity has a **functional currency** (e.g. Nigeria NGN, UK GBP, US USD,
  Australia AUD, Canada CAD). Transactions are recorded in the local currency.
- **`fx_rates`** stores immutable, effective‑dated exchange rates. Journal lines
  capture the FX rate **at transaction time**, so history is never re‑stated by
  later rate changes.
- **Consolidation to NGN** is produced by a database function
  (`consolidated_statement_ngn`) that converts posted activity at historical
  rates and emits currency‑translation adjustments for period‑end revaluation.
- **Legal vs operational separation:** international entities are marked as
  separate foreign entities with their own statutory jurisdiction, so a
  **statutory report mode** can isolate one legal entity for local audit/filing,
  while **operational consolidation** rolls everything up for management.
- **Diaspora giving** distinguishes the *legal receipt entity*
  (`recording_entity_id`) from the *ministry attribution* (`attribution_entity_id`)
  on each gift.

---

## 9. The Modules — What The Platform Does

Each module posts to the ledger and respects roles, scope, SoD, and audit.

### 9.1 Givings
- **Unique giver identity.** One person recorded differently across campuses
  resolves to a single `giver_id`. A fuzzy matcher (pg_trgm) resolves exact
  phone/email to the existing person and flags close, non‑exact matches into a
  **potential‑duplicates review queue** (merge unifies their history).
- **Giving types with behaviour** — tithe, offering, seed, first‑fruit, building
  fund, missions pledge, vow, partnership, event offering — each mapped to a
  fund classification and income account.
- **Every gift posts a balanced journal entry** (debit cash/bank by channel,
  credit the type's income account).
- **Pledges/vows as receivables** with auto‑calculated outstanding balance and an
  **AR‑style aging report**.
- **Giving statements** — per‑giver, per‑year, printable for tax purposes.
- **Screens:** dashboard, fast batch record‑giving for clerks, giver search +
  unified history, duplicates queue, pledges + aging, statements.

### 9.2 Requisitions & Disbursements (Expenses)
- Request intake with vendor selection, urgency, WHT fields, and branch/level
  routing; **compilation** of non‑urgent requests into batches.
- **Config‑driven approval chains** by branch and raising level, with a
  conditional **Board of Trustees** gate as a final cross‑cutting step.
- **Finance processing** queue, bank‑upload and transfer‑instruction references,
  and **slot‑based signatory confirmations** per bank account (all‑members or
  any‑one models).
- **Ledger close‑out:** a posted expense journal entry is generated on final
  disbursement, only after all required signatures are satisfied.
- **Withholding tax (WHT)** is auto‑computed (generated columns) and tracked in a
  remittance log (owed / partially remitted / remitted / overdue).

### 9.3 Payroll & Honorariums
- **Staff registry** distinguishing `minister_clergy` vs `administrative`, with
  entity‑scoped location, employment status, PAYE state, and pension metadata.
- **Configurable compensation components** (base + allowances) with per‑component
  taxable treatment (e.g. clergy housing).
- **Configurable PAYE rules** by state and staff type; payroll runs compute PAYE,
  pension, NHF, gross and net, generate reviewable line items, and **post
  balanced payroll journal entries on approval**.
- **Honorariums** for guest ministers / visiting speakers / resident
  intercessors with their own threshold approval flow and a distinct ledger
  source.

### 9.4 Budgeting
- **Budget cycles** (open → under review → approved → closed) with **budget
  lines** per entity and account, keeping proposed vs approved amounts and review
  justifications separate.
- **Historical linkage** to prior cycles for trend analysis.
- **Budget‑vs‑actual rollup** (actuals derived from the ledger) by hierarchy and
  fund classification.
- **Enforcement settings** per entity (warn / block / none) with over‑budget
  warnings/blocks surfaced at requisition time.

### 9.5 Fund Accounting & Investments
- **Named restricted funds** with targets and purpose; balances derived from the
  ledger.
- **Allowed‑use whitelist** for restricted funds; restricted expense debits are
  checked before they can post.
- **Formal inter‑fund / inter‑entity loans** so borrowing is documented, not
  hidden as an informal transfer.
- **Investments** (fixed deposits, treasury bills, …) with maturity alerts and
  expected‑vs‑actual yield tracking.

### 9.6 Events
- Events are **temporary cost‑centre entities** with their own mini‑P&L.
- Revenue lines (tickets, sponsorships, exhibitor fees, on‑site giving,
  offerings, merchandise) and cost lines (venue, logistics, speaker honorarium,
  hospitality, staffing, production/simulcast).
- **Cost sharing** across contributing entities and **giving‑attribution rules**
  (host / giver‑home / split), plus lightweight **event inventory**.
- **Close‑out report** with net position, cost per attendee, inventory close‑out,
  and historical comparison by event type.

### 9.7 Next Level Prayers (Ministry Directorate)
- A **partner directory** where each partner resolves to a unique giver, with
  configurable **partnership tiers** and monthly commitments; fulfilment flows
  through the shared giving model and **lapse detection** surfaces partners who
  miss consecutive periods.
- **Programmes** (prayer conferences, schools, retreats) reuse the Event pattern.
- **Digital products** (devotionals, courses, subscriptions) with **deferred
  revenue** schedules over the access period.
- **Resident‑intercessor stipends** route through the honorarium path.

### 9.8 International (Multi‑Currency & Cross‑Border)
- Consolidated (NGN) vs statutory (single legal entity) reporting toggle.
- **FX rate capture** and historical translation.
- **Cross‑border transfers** requiring documentation before moving beyond
  pending review, with group‑level approval controls.

### 9.9 Reconciliation & Cash Custody
- **Bank feed** ingestion (Mono/Okra/manual) per bank account.
- **Auto‑matching** of bank transactions to journal entry lines (by amount, date
  proximity, currency, entity, description similarity), with a manual review
  queue for the rest.
- **Stale unreconciled controls** surfacing old unmatched giving/expense items.
- **Cash count sessions** with **dual‑counter enforcement** and **cash deposits**
  with automatic variance calculation and flagging.

### 9.10 Governance & Compliance
- **NFIU large‑cash awareness** via a configurable threshold view.
- **SCUML compliance log** per legal entity.
- **WHT remittance dashboard** (owed / remitted / outstanding / overdue).
- **Related‑party enforcement** (disclosure required; higher‑tier routing) and a
  **conflict‑of‑interest registry**.
- **Whistleblower channel** with anonymous submissions and governance‑only
  visibility.
- **Audit log viewer** with filters, CSV export, and print output.

### 9.11 Admin
User↔entity↔role assignment, chart of accounts, entity management, approval‑chain
configuration, and the seeded role‑slot registry for placeholder→real‑person
handover.

---

## 10. Spreadsheet Imports

A single reusable pipeline — **stage → validate (dry‑run preview) → commit** —
behind a hub at `/imports` and a reusable **Import** button on any list page.
Twelve import types, each with a **downloadable template + data dictionary**:
Givers/Contacts, Historical Giving, Opening Balances, Bank Statement, Chart of
Accounts, Vendors, Pledges, FX Rates, Investments, Staff, Restricted Funds,
Entities/Campuses.

- **Ledger‑safe:** historical giving posts real journal entries; **opening
  balances** post one balanced entry per entity/date, plugged to an Opening
  Balance Equity account. No parallel balances.
- **De‑duplication:** giver imports reuse the fuzzy matcher, so migrating a large
  membership never spawns duplicates.
- **Robust:** per‑row validation with an error report, per‑row commit isolation
  (partial commits), and raw files archived to private storage. `.xlsx/.xls/.csv`
  supported.

---

## 11. Bulk Management at Scale

For a 40k+ member organisation, lists support **server‑side pagination**,
**select‑all‑on‑page** and **select‑all‑matching‑the‑filter across entities**,
with a bulk toolbar:

- **Export CSV**, **Print** (e.g. giving statements), and **Email**.
- **Email opens the staff member's own mail app** (`mailto:` with recipients in
  BCC), sent from their own finance account — no third‑party mail service. Large
  selections are pointed to CSV export for mail‑merge.
- **Immutability‑safe deletes:** master data is *deactivated* (history
  preserved), staging/drafts can be removed, and posted financial records are
  corrected via reversing entries — never hard‑deleted.

The flagship Givers list demonstrates all of this; the same components extend to
any list.

---

## 12. Reporting & Analytics

- **Rollups** by entity hierarchy and fund classification, derived from the
  ledger, so campus → sub‑group → group → consolidated always reconcile.
- **Report functions** for executive dashboards, operational ministry rollups,
  programmatic P&L, and statutory financial statements per legal entity.
- **Analytics views** (giving monthly / YoY / seasonality / velocity, HNI and
  lapsed‑major givers, expense anomaly flags, cash‑flow forecast) computed from
  the ledger.
- Statements and reports are printable / PDF‑ready.
- **Ask the ledger (AI):** a natural‑language analytics page turns questions into
  scoped, read‑only SQL over approved reporting views (Anthropic‑powered). Dashboard
  callouts can deep‑link here with a pre‑filled, auto‑running question.

### Interactive Executive Dashboard
The super‑admin / auditor home is a live executive dashboard, and **every other
cadre gets a scope‑aware version** of it filtered to the entities they oversee:

- **KPI cards** — consolidated giving, budget variance, restricted funds, pending
  approvals (org‑wide), compliance attention, upcoming maturities. Figures use
  compact notation (₦26.9bn / £1.2m); each card is **clickable** to a callout
  showing the breakdown that feeds it, with an **Open →** to the module. Cards
  that need action show a **red “Attention” pulse**; healthy ones a green dot.
- **Charts (Recharts, mobile‑adaptable):** consolidated giving trend, income vs
  expense, giving by group, and restricted‑fund funding progress.
- **Group budget vs actual** — colour‑coded by utilisation (on‑track / near /
  over), each group clickable to detail.
- **Approvals** — an **All (org‑wide) / Mine** toggle. (A super‑admin is never a
  chain approver, so “Mine” is legitimately empty; the metric is the org‑wide count.)
- **Restricted funds / compliance / maturities** — severity‑coded lists; restricted
  funds link to **AI analysis**; maturities open the all‑investments portfolio.
- **Global search (scope‑aware):** the top‑bar search queries entities, givers,
  vendors, and requisitions **restricted to the signed‑in user’s accessible
  entities**, so each person only finds what they are allowed to see.

### Giving Breakdown & Analytics
`/givings/breakdown` presents an expandable **group → sub‑group → campus** tree
(plus ministries such as NLP) with **characteristic totals** — Sunday offering,
midweek offering, tithe, seed, partnership, redeemed pledges — and a **channel
mix** (bank transfer / POS / cash / online). Sunday vs midweek is derived from the
gift’s day‑of‑week. Clicking any entity opens a per‑entity analytics view with
**Month‑on‑Month, Week‑on‑Week and Year‑on‑Year** charts and channel breakdown.
NLP shows **daily + weekly inflow**. The giving home leads with a **weekly
consolidated (NGN)** figure whose callout breaks down by currency.

---

## 13. Security Model

- **Authentication** via Supabase Auth; **middleware** gates every route.
- **Authorisation** is entity‑scoped and cascades through the hierarchy; global
  roles (`super_admin`, `auditor`) are the only entity‑less ones.
- **Segregation of duties** in two layers (app + database).
- **Row Level Security** enabled on all tables (defence‑in‑depth).
- **Encryption at rest:** bank and vendor account numbers are encrypted with a
  key held in **Supabase Vault**; only the last four digits are stored in clear,
  and decryption is via a restricted function.
- **Audit** of every action with before/after snapshots.
- **Immutable ledger** so financial history cannot be quietly altered.

---

## 14. The Demo / Presentation Dataset

A realistic dataset for leadership demos lives in `scripts/mock` and is **fully
reversible in one command**.

```bash
node --env-file=.env.local scripts/mock/seed.mjs    # build the demo
node --env-file=.env.local scripts/mock/reset.mjs   # wipe it, restoring exact pre-seed state
```

It builds the exact 4‑group org (Group 1 International, Group Alpha, Group 3,
Group 4) → sub‑groups → 41 campuses across currencies; ~3,700 givers and ~13,000
gifts posted to the ledger (which **balances to ~₦18.8bn**); income in the right
magnitudes (₦17bn + £12m + $4.4m + …); payroll with PAYE, budgets, funds,
investments; NLP partnerships and **two prayer conferences (Nigeria ₦2.5bn,
London £1.2m)**; requisitions → disbursements + WHT; reconciliation; and
governance records.

**Reset** snapshots the pre‑seed baseline and restores it exactly; it `TRUNCATE`s
the transactional tables (which bypasses the ledger immutability guard, so the
admin reset is clean) and removes only demo entities/users. Nothing outside the
demo is touched. Demo logins use password `Test1234!` (see the README for the
list; e.g. `admin@harvestersng.org`, `dayo.ogunrombi@harvestersng.org`).

---

## 15. Operations & Maintenance

- **Environment:** `.env.local` (git‑ignored) holds the Supabase URL, publishable
  key, and the server‑only `DATABASE_URL`. Set the same in production hosting.
- **Migrations:** `supabase/migrations/0001…0020`. Apply with the runner:
  `node --env-file=.env.local scripts/db-run.mjs supabase/migrations/*.sql`.
- **Verification scripts** (`scripts/`): `test-ledger.mjs` (ledger integrity),
  `rls-check.mjs`, `test-auth.mjs`, `test-givings.mjs`, `test-imports.mjs`.
- **First run:** create the first account at `/login` (it bootstraps as
  `super_admin`), then assign everyone else under Admin → Access & Roles.

---

## 16. Known Limitations & Production Hardening

Before going fully live, address:

- **Auth conveniences are on for internal use:** new users auto‑confirm (no
  SMTP), and the first registered user auto‑becomes `super_admin`. Remove/gate
  these when real email is configured.
- **Server data access uses a direct Postgres connection** (a Supabase
  service‑role key was not provided). Rotate the database password before
  production; optionally switch server access to the service‑role key.
- **Migrations are applied via a script**, not a tracked migration table — adopt
  the Supabase CLI or a migration ledger to keep environments in sync.
- **The `xlsx` (SheetJS) parser** has a known advisory in its npm build; pin to
  the patched SheetJS distribution for production.
- **Automated test coverage** exists for the ledger/auth/givings/imports; extend
  it to the later modules (payroll tax, restricted‑fund enforcement, WHT,
  reconciliation variance).
- **Real‑usage bugs fixed:** `create_vendor` and `detect_lapsed_partners` were
  found and fixed (migration `0020`). Keep simulating real flows to surface more.
- **Bulk giving imports** post one entry at a time; a set‑based poster would speed
  very large migrations.

---

## 17. What Each Role Can Do

| Role | Typical person | Can see | Can do |
| --- | --- | --- | --- |
| `super_admin` | System admin | Everything | All admin + all financial operations |
| `cfo_coo` | Group CFO/COO | Whole org | Approvals, finance processing, all reports |
| `global_lead_pastor` | Lead pastor | Whole org | Executive oversight, dashboards |
| `group_pastor` | Group pastor | Their group ↓ | Oversight, approvals in their group |
| `group_finance_officer` | Group accountant | Their group ↓ | Record, compile, review, report |
| `sub_group_finance_officer` | Sub‑group accountant | Their sub‑group ↓ | Record, compile, review |
| `campus_finance_officer` | Campus finance | Their campus | Record giving/expenses, reconcile |
| `campus_admin` | Campus admin | Their campus | Day‑to‑day campus entry |
| `campus_data_entry_clerk` | Clerk | Their campus | Fast batch giving entry |
| `ministry_lead` / `ministry_director` | e.g. NLP head | Their ministry | Partnerships, programmes, ministry finance |
| `finance_processor` | Central finance | Assigned | Process approved disbursements |
| `bank_signatory` | Authorised signatory | Assigned | Confirm disbursement signatures |
| `board_trustee` | Trustee | Governance scope | Board‑level approvals, disclosures |
| `governance_officer` | Compliance | Governance scope | Audit log, WHT, whistleblower, SCUML |
| `auditor` | Auditor | Everything (read‑only) | Read + export; no changes |

*Access always cascades down the hierarchy from the granted entity; only
`super_admin` and `auditor` are global.*

---

## 18. Glossary

- **Journal entry / line** — a posted transaction and its debit/credit lines.
- **Posting** — making a draft entry permanent (after it balances).
- **Reversing entry** — a new balanced entry that undoes a posted one; the
  correction mechanism (deletion is never used).
- **Fund classification** — unrestricted / temporarily restricted / permanently
  restricted / board‑designated.
- **Functional currency** — the currency an entity operates and reports in.
- **Presentation currency** — the currency a consolidated report is expressed in
  (NGN for group consolidation).
- **WHT** — withholding tax deducted from vendor payments and remitted to the
  authorities.
- **PAYE** — Pay‑As‑You‑Earn employee income tax.
- **SoD** — Segregation of Duties (creator ≠ approver).
- **RLS** — Row Level Security (database‑level access control).
- **Entity** — any node in the org tree (group, sub‑group, campus, ministry,
  event).
- **Accessible entities** — the set of entities a user may see/act on, computed
  from their role grants plus all descendants.

---

*This document reflects the platform as built through migration `0020`, plus the
app‑layer interactive dashboards, giving breakdown/analytics, scope‑aware home,
global search, and spreadsheet‑import/bulk‑management features added since. It is a
living reference — keep it beside the code and update it as the system grows.*
