# Harvesters Finance OS

A ledger-grade financial operating system for **Harvesters International
Christian Centre**.

> **Founding principle.** Every financial module sits on top of one immutable,
> append-only, double-entry ledger. Every transaction has a debit and a credit
> side that must balance. **Nothing is ever deleted** — corrections are
> reversing entries. Balances are always *derived* from the ledger, never
> written directly. This rule is enforced from the foundation up so that audit,
> compliance, and "who changed what" are possible without a rebuild.

## Status — Phase 0 (Scaffold)

This phase is **shell, design system, and folder architecture only**. There are
no data models or business logic yet.

- ✅ Next.js 14 (App Router) + TypeScript
- ✅ Tailwind design system — strict black / white with silver as a sparing accent
- ✅ Typography — Futura (display) with fallbacks, Montserrat (body/UI)
- ✅ Component library foundation — Card, Table, Form, Modal, Badge, StatusPill, Button
- ✅ Persistent collapsible left sidebar shell with all module links
- ✅ Module folder architecture under `app/(modules)/*`
- ✅ Supabase client wiring + environment templates

## Status — Phase 1 (Foundational data model)

The ledger foundation everything else depends on. Live in Supabase (Postgres 17),
full RLS from the start.

- ✅ **Polymorphic entity hierarchy** — Group → Sub-Group → Campus (arbitrary
  depth via `parent_entity_id`), plus parallel Ministry Expression and temporary
  Event nodes. Seeded with real Harvesters structure (incl. international
  campuses in GBP/USD).
- ✅ **Global chart of accounts** — shared structure; every ledger line ties an
  account to a specific entity, enabling per-entity *and* consolidated reporting.
- ✅ **Immutable double-entry ledger** — `journal_entries` + `journal_entry_lines`.
  Database triggers enforce: balanced debits = credits (presentation currency)
  before posting; posted entries/lines can never be UPDATE'd or DELETE'd;
  corrections are balanced reversing entries only. Triggers fire for *every*
  writer, including privileged ones.
- ✅ **Multi-bank model** — account numbers **encrypted at rest** (pgcrypto +
  key in Supabase Vault); plaintext never stored; decrypt only via a restricted
  `SECURITY DEFINER` function.
- ✅ **Row Level Security** on all tables — anon has no access; authenticated is
  read-only; writes go through trusted server code. Role-based write policies
  arrive with the auth phase.
- ✅ **Internal admin UI** (`/admin`) to view and create entities and accounts.
- ✅ Verified: `scripts/test-ledger.mjs` (15 integrity assertions) +
  `scripts/rls-check.mjs`.

## Status — Phase 2 (Auth + role-based access)

Supabase Auth with entity-scoped RBAC, segregation of duties, and automatic
audit logging.

- ✅ **Login / signup** ([`/login`](app/login/page.tsx)) with session-refresh
  middleware guarding every route; sign-out in the top bar. Internal-tool
  convenience: new users auto-confirm (no SMTP) and the **first registered user
  bootstraps as global super_admin**.
- ✅ **Roles mirror the hierarchy** — `user_entity_roles(user_id, entity_id,
  role, granted_by, granted_at)`. Scoped roles are tied to specific entities and
  **cascade to descendants** (a sub-group finance officer sees its campuses);
  `super_admin` and `auditor` are global. A check constraint enforces
  global-only-vs-entity-scoped.
- ✅ **Segregation of duties** — the creator of a draft cannot post it. Enforced
  in the app before approving (durably logs the attempt via `log_sod_violation`,
  then refuses) **and** as a hard DB backstop in `post_journal_entry`.
- ✅ **Entity-scoped guards** — middleware (coarse auth gate) + server helpers
  (`requireUser`, `requireSuperAdmin`, `accessible_entity_ids`) that scope what
  each user sees/does; RLS policies mirror the same functions for direct client
  reads.
- ✅ **Automatic audit log** — one reusable trigger (`app_private.tg_audit`) on
  every table captures create/update/approve/reverse/delete with actor,
  timestamp, entity, and before/after JSON snapshots. Modules never call it. The
  actor is resolved from a transaction-local setting (`withActor`) since writes
  use the owner connection.
- ✅ **Super-admin access screen** ([`/admin/access`](app/\(modules\)/admin/access/page.tsx))
  to assign and revoke user↔entity↔role.
- ✅ Verified: `scripts/test-auth.mjs` (14 assertions — cascade, SoD, audit),
  `scripts/test-signup.mjs` (real Supabase Auth signup → bootstrap chain).

> **First-run:** open `/login`, create your account (you become super_admin),
> then use `/admin/access` to invite/assign everyone else. Have others sign up
> first so they appear in the user picker.

## Status — Phase 3 (Givings)

Full giving lifecycle on top of the ledger — nothing keeps a parallel balance.

- ✅ **Unique giver identity** — `givers` + `giver_identifiers` (one person,
  recorded differently across campuses, resolves to one `giver_id`). A
  `pg_trgm` fuzzy matcher (`find_giver_matches`) resolves exact phone/email to
  the same giver, and flags **close but non-exact** matches into a
  **potential-duplicates review queue** instead of silently duplicating. Merge
  unifies all history under one identity.
- ✅ **Giving types with behaviour** — `giving_types` (tithe, offering, seed,
  first-fruit, building-fund, missions-pledge, vow, partnership, event-offering)
  each mapped to a default fund classification + income account.
- ✅ **Every gift posts to the ledger** — `post_giving_record` creates a
  balanced journal entry (debit cash/bank by channel, credit the type's income
  account) and links it back; there is no separate giving balance.
- ✅ **Pledges/vows as receivables** — `pledges` + `pledge_fulfillments`
  (auto-outstanding, auto-fulfilled), with an **AR-style aging view**
  (`pledge_aging`) bucketed against the target date.
- ✅ **Giving statements** — per-giver, per-year, PDF-ready (printable) with
  totals by type, by entity, and a dated transaction list.
- ✅ **Screens** — givings dashboard, a fast batch **record-giving** screen for
  clerks, giver search + **unified history** view (doubles as giver-facing "my
  giving"), duplicates review queue, pledges + aging, and statements.
- ✅ Verified: `scripts/test-givings.mjs` (18 assertions — ledger posting,
  fuzzy match, merge, pledge aging/fulfillment, statement),
  `scripts/test-givings-queries.mjs` (read-query schema check).

### Database

Migrations live in [`supabase/migrations`](./supabase/migrations); seed in
[`supabase/seed.sql`](./supabase/seed.sql). Apply / verify against the direct
connection (server-only `DATABASE_URL`):

```bash
node --env-file=.env.local scripts/db-run.mjs supabase/migrations/*.sql
node --env-file=.env.local scripts/db-run.mjs supabase/seed.sql
node --env-file=.env.local scripts/test-ledger.mjs   # integrity proof
node --env-file=.env.local scripts/rls-check.mjs      # RLS/grants proof
```

> The admin UI reaches Postgres server-side over `DATABASE_URL` (a Supabase
> service-role/secret key was not provided). Add `SUPABASE_SERVICE_ROLE_KEY`
> later to switch server data access to supabase-js if preferred.

## Status — Phase 4 (Requisitions and Disbursements)

Full request-to-payment lifecycle replacing the manual email chain while keeping
each stage separately trackable.

- ✅ **Request intake** with vendor selection/creation, urgent flag, WHT fields,
  branch/level routing metadata, and requester tracking.
- ✅ **Compilation** screen for batching submitted non-urgent requests before
  approval; urgent requests route directly into the same approval chain.
- ✅ **Config-driven approvals** by branch and raising level, with conditional
  Board of Trustees gate appended as the final cross-cutting approval step.
- ✅ **Finance processing** queue for approved requests/batches, bank upload and
  transfer-instruction references, and WHT/net payable carry-through.
- ✅ **Slot-based signatory confirmations** plus super-admin slot/member setup
  per bank account, supporting all-members and any-one slot models.
- ✅ **Ledger close-out** on final disbursement: a posted expense journal entry
  is generated only after all required signature slots are satisfied.

## Status — Phase 5 (Payroll and Honorariums)

Staff compensation is now separate from honorariums, with clergy/admin
distinctions represented directly in the data model.

- ✅ **Staff registry** with `minister_clergy` and `administrative` staff types,
  entity-scoped work location, employment status, PAYE jurisdiction, and pension
  metadata.
- ✅ **Configurable compensation components** for base salary and allowances,
  including per-component taxable treatment for clergy housing and other edge
  cases without hardcoding.
- ✅ **Configurable PAYE rules** by state and staff type, used to calculate PAYE,
  pension, NHF, gross, and net payroll line items.
- ✅ **Payroll runs** that generate reviewable line items and post balanced
  payroll journal entries to the ledger on approval.
- ✅ **Honorarium payments** for guest ministers and visiting speakers, with
  their own threshold approval flow and distinct `honorarium` ledger source.

## Design system

| Token | Value | Usage |
| --- | --- | --- |
| `ink` | `#0A0A0A` (+ shades) | Primary — text, primary buttons, sidebar |
| `paper` | `#FFFFFF` (+ shades) | Surfaces, cards, backgrounds |
| `silver` | `#C0C0C0` / `#D4D4D4` | **Accent only** — dividers, active states, highlights |
| `status.*` | desaturated | Approval / ledger-state pills **only** |

- **Display / headings:** Futura (`--font-display`) — falls back to Futura PT /
  Century Gothic / Montserrat until real Futura files are supplied. Drop them in
  `public/fonts` and uncomment the `@font-face` blocks in `app/globals.css`.
- **Body / UI:** Montserrat (Google Font, via `next/font`).
- No default SaaS blue/purple anywhere.

## Project structure

```
app/
  (modules)/            # module route group
    givings/  expenses/  payroll/  budgeting/  funds/
    events/   next-level-prayers/  international/  analytics/  admin/
  layout.tsx            # root layout -> AppShell
  page.tsx              # dashboard (overview)
  globals.css           # design tokens + font stacks
components/
  shell/                # AppShell, Sidebar, Topbar, ModulePlaceholder
  ui/                   # Card, Table, Form, Modal, Badge, StatusPill, Button
lib/
  navigation.ts         # nav manifest (single source of truth)
  utils.ts              # cn() class merger
  supabase/             # browser + server client wiring
supabase/               # (empty) — schema & migrations arrive with the ledger
```

## Getting started

```bash
cp .env.local.example .env.local   # fill in Supabase keys
npm install
npm run dev                        # http://localhost:3000
```

## Environment

See [`.env.local.example`](./.env.local.example). Set the same variables in your
hosting provider for production. The `SUPABASE_SERVICE_ROLE_KEY` is server-only —
never prefix it with `NEXT_PUBLIC_`.

## Brand

Harvesters International Christian Centre — black & white, occasional silver.
Futura (display) / Montserrat (body).
