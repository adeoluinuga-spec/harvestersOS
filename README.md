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

## Status — Phase 6 (Budgeting)

Bottom-up budgeting with top-down review authority and requisition-time budget
visibility.

- ✅ **Budget cycles** with open, review, approved, and closed states.
- ✅ **Budget lines** submitted by entity and account, preserving proposed
  amounts separately from approved amounts and review justifications.
- ✅ **Historical linkage** from each cycle's lines to prior-cycle lines, ready
  for future forecasting and trend analysis.
- ✅ **Rollup dashboard** by entity hierarchy and fund classification, showing
  budget vs actuals derived from requisitions.
- ✅ **Budget enforcement settings** per entity with warn, block, or none modes.
- ✅ **Requisition integration** with budget-line selection and over-budget
  warnings/blocks based on the selected entity's policy.

## Status — Phase 7 (Fund Accounting and Investments)

Restricted fund rules are enforced explicitly instead of relying on convention.

- ✅ **Named restricted funds** with target amounts, purpose, entity ownership,
  and balances derived from posted ledger lines.
- ✅ **Allowed-use whitelist** for temporarily/permanently restricted funds;
  restricted expense debits are checked before ledger lines can post.
- ✅ **Restricted activity dashboard** showing balance, target, percent funded,
  allowed uses, and recent ledger activity.
- ✅ **Formal inter-fund/inter-entity loans** so borrowing from a fund/entity is
  documented instead of hidden as an informal transfer.
- ✅ **Investments tracking** for fixed deposits, treasury bills, and other
  instruments with maturity alerts and expected-vs-actual yield reporting.

## Status — Phase 8 (Events)

Events now operate as temporary cost-center entities with their own mini-P&L.

- ✅ **Event details** attached to Phase 1 `event` entities, including host,
  event type, attendee count, dates, and lifecycle status.
- ✅ **Revenue and cost entry** for tickets, sponsorships, exhibitor fees,
  giving, merchandise, venue, logistics, honorariums, hospitality, staffing, and
  production/simulcast costs.
- ✅ **Cost sharing** per cost line by percentage or fixed amount across
  contributing entities.
- ✅ **Giving attribution rules** per event: host, giver home entity, or split.
- ✅ **Lightweight event inventory** for stocked, sold, returned, adjusted, and
  unsold merchandise/books.
- ✅ **Close-out report** with revenue, cost, net position, cost per attendee,
  inventory close-out, and historical comparison by event type.

## Status - Phase 9 (Next Level Prayers)

Next Level Prayers now has its own ministry-directorate partnership layer while
reusing the shared giving, event, and honorarium models.

- Done **Ministry Directorate entity** support via `ministry_directorate`, with
  Next Level Prayers normalized as the special-ministry entity.
- Done **Partner directory** where every partner resolves to a unique Phase 3
  `giver_id`, with configurable partnership tiers and monthly commitments.
- Done **Partnership fulfillment** through the Phase 3 `giving_records` table
  using `giving_type = partnership`, linked back to commitments by
  `partnership_fulfillments`.
- Done **Lapse detection** for partners missing 2+ consecutive expected periods,
  surfaced as an actionable lapsed-partner list.
- Done **NLP programs** use the Phase 8 event pattern: prayer conferences,
  prayer schools, and retreats are `event_details` rows hosted by NLP.
- Done **Digital products** with deferred revenue schedules over the access
  period for devotionals, courses, and subscriptions.
- Done **Resident intercessor stipends** route through the Phase 5 honorarium
  approval/payment path using a distinct resident-intercessor recipient type.
- Done **NLP dashboard** with partner counts, tier breakdown, lapsed alerts,
  financial summary, digital sales, and program activity.

## Status - Phase 10 (Multi-Currency and Cross-Border Compliance)

International reporting now separates legal/statutory reporting from operational
consolidation, with historical FX captured on ledger lines.

- Done **FX rate table** with immutable effective-date rates and transaction-time
  rate capture on every new journal entry line.
- Done **NGN consolidated reporting** through a database function that converts
  posted activity at historical transaction rates and emits currency translation
  adjustment rows for period-end balance revaluation.
- Done **Legal entity separation** with `statutory_jurisdiction` on entities;
  non-NGN international entities are normalized as separate foreign entities.
- Done **Statutory report mode** that isolates one `separate_foreign_entity` at
  a time for local audit/filing needs.
- Done **Cross-border transfer compliance** with required documentation before a
  transfer can move beyond pending review, plus group-level approval controls.
- Done **Diaspora giving distinction** with legal receipt (`recording_entity_id`)
  separated from ministry attribution (`attribution_entity_id`) on giving
  records and the record-giving UI.
- Done **International dashboard** with consolidated/statutory toggle, FX rate
  capture, transfer requests, and documentation review.

## Status - Phase 11 (Reconciliation and Cash Custody)

Bank activity and physical cash handling now have explicit control workflows.

- Done **Bank feed foundation** for Mono/Okra/manual transaction ingestion per
  bank account, with provider/external transaction identifiers.
- Done **Reconciliation matches** linking bank feed transactions to immutable
  journal entry lines with auto/manual match types and matcher audit fields.
- Done **Auto-matching** by amount, date proximity, currency, entity, and rough
  description similarity, with a manual review queue for unmatched feed items.
- Done **Stale unreconciled controls** surfacing old unreconciled giving records
  and disbursed expense payments against configurable thresholds.
- Done **Cash count sessions** with dual-counter enforcement at the database
  layer using a distinct `counted_by` user array.
- Done **Cash deposits** linked to count sessions, with variance calculated by
  trigger and non-zero variances auto-flagged for review.
- Done **Reconciliation dashboard** with bank feed ingest, auto/manual matching,
  cash count/deposit entry, and campus variance reporting.

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
