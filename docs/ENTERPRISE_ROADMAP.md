# Harvesters Finance OS — Enterprise Hardening Roadmap

> Companion to the [Bible](HARVESTERS_FINANCE_OS_BIBLE.md). This tracks the
> journey from "correct accounting engine" to "system a board and an auditor
> can rely on", in three phases. Update the status column as work lands.

## Where this came from

A full enterprise gap analysis (July 2026) compared the platform against Sage
Intacct, NetSuite, Zoho Finance, Xero and church-sector tools (Aplos, Pushpay).
Verdict: the immutable double-entry ledger core is genuinely competitive — the
gaps were operational (period close, testing, background jobs, least-privilege
access, document management, live bank/payment rails).

---

## Phase 1 — Controls & credibility ✅ (built July 2026)

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 1 | Fiscal periods (monthly, calendar FY) + open/close + posting guard | ✅ | `0023_fiscal_periods.sql`, Admin → Periods |
| 2 | Future-dated postings rejected at the database | ✅ | `0023` guard v2 |
| 3 | Gapless sequential JE numbers per entity per year (`JE-2026-000123`) | ✅ | `0023` (backfilled for all existing entries) |
| 4 | Year-end close → Retained Earnings (3900), `closing` source module | ✅ | `0022`, `0023`; reports exclude closing from P&L (`0027`) |
| 5 | Giving `amount_ngn` captured at write time (kills per-row FX in dashboards) | ✅ | `0024`; dashboards/analytics/weekly reports read the column |
| 6 | Idempotent giving entry (`client_key` unique) — double-submit is a no-op | ✅ | `0024`, RecordGivingForm |
| 7 | Least-privilege DB logins: `hfos_app` (DML only, 20s timeout), `hfos_ai` (analytics views only, read-only, 10s) | ✅ | `0026`, `0028`, `scripts/provision-db-roles.mjs` |
| 8 | `app_users` owner view (auth emails without auth-schema grants) | ✅ | `0028` |
| 9 | Tracked migrations (`schema_migrations`: checksum, drift detection) | ✅ | `scripts/db-migrate.mjs`, `npm run db:migrate` |
| 10 | Background jobs: approval SLA escalation, maturity alerts, outbox drain | ✅ | `0025` (pg_cron nightly), `/api/jobs` (+ `vercel.json` crons) |
| 11 | Security headers (CSP, HSTS, frame-deny) + rate limiting (login/search) | ✅ | `next.config.mjs`, `middleware.ts` |
| 12 | Ledger/period/SoD/idempotency test suite (10 tests, rollback-isolated) | ✅ | `tests/`, `npm test` |
| 13 | CI: lint + typecheck + build + (secret-gated) DB integrity tests | ✅ | `.github/workflows/ci.yml` |
| 14 | Demo seed corrected: no future-dated gifts; reset clears period layer | ✅ | `scripts/mock/lib.mjs` |

**Still open in Phase 1 (needs owner action):**
- Push the repo to GitHub and add the `TEST_DATABASE_URL` secret so CI's DB job runs.
- Enable PITR + verify a restore quarterly (Supabase dashboard).
- Enforce MFA for approver/signatory accounts (Supabase Auth settings + enrollment UI — Phase 2 item 7).
- Set `APP_DATABASE_URL`, `AI_DATABASE_URL`, `CRON_SECRET` in production hosting.
- Pin the patched SheetJS distribution (xlsx advisory).

## Phase 2 — Operational depth (next)

1. **Attachments everywhere** — invoices on requisitions, documents on JEs,
   bank letters on vendors (Supabase Storage private buckets, reuse the
   imports archive pattern). *An expense without an invoice is un-auditable.*
2. **Live bank feeds** — real Mono/Okra API integration feeding
   `bank_feed_transactions`; recon-aging KPI on the executive dashboard.
3. **Daily FX** — automated CBN (or official source) rate ingestion with a
   documented rate policy (transaction vs month-end close vs average).
4. **Online giving ingestion** — Paystack/Flutterwave webhooks → giver
   resolution → auto-posted, auto-reconciled gifts. Removes most manual entry
   AND most reconciliation debt at once.
5. **Intercompany eliminations** in `consolidated_statement_ngn` (transfers
   between entities must not double-count group income/expense).
6. **Fixed asset register** — capitalization, depreciation runs, disposal
   (statutory requirement for incorporated trustees).
7. **MFA enrollment UI** + enforcement for approvers and bank signatories.
8. **Sub-ledger ↔ control account tie-outs** (pledges vs AR control, WHT log
   vs WHT liability account).

## Phase 3 — Scale & polish

1. Materialized/incremental dashboard aggregates; partition `audit_log` by
   month (it is already 86% of the database).
2. Statement → account → journal entry → source document **drill-down report
   writer** (the killer auditor feature; the data model already supports it).
3. Keyboard-first batch giving grid (spreadsheet-style Sunday entry).
4. Optimistic UI on approvals; accessible primitives (Radix/React Aria).
5. Budget versions/scenarios and rolling forecast.
6. Error tracking (Sentry) + uptime/outbox-backlog alerting.
