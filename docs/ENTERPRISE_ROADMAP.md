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

## Phase 2 — Operational depth ✅ (built July 2026)

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 1 | Document attachments (private bucket, 15MB, soft-delete, audit) — invoice upload on requisitions, finance queue shows attachments or a red "No invoice" badge | ✅ | `0029_documents.sql`, `lib/documents.ts`, `/api/documents/[id]` |
| 2 | Fixed asset register: capitalize through the ledger, straight-line monthly depreciation (idempotent, nightly job), disposal with gain/loss | ✅ | `0030_fixed_assets.sql`, `/assets` |
| 3 | Online giving ingestion: Paystack webhook (HMAC-verified, idempotent) → exact giver match → posted + reconciled gift; review queue for ambiguity | ✅ | `0031_online_giving.sql`, `/api/webhooks/paystack`, `/givings/online` |
| 4 | Daily FX auto-ingestion (open.er-api.com default; `FX_RATE_SOURCE_URL` override) in nightly jobs | ✅ | `lib/fx.ts`, `/api/jobs` |
| 5 | Mono bank-feed API sync + auto-match in nightly jobs (graceful without key) | ✅ | `lib/bankFeeds.ts` |
| 6 | WHT in the ledger: disbursement posts gross expense / net bank / WHT Payable (2200); remittance posting clears it | ✅ | `0032_wht_intercompany_tieouts.sql` |
| 7 | Intercompany accounts (1900/2900) + cross-border transfer posting + consolidation elimination rows | ✅ | `0032`, wired into International documenting flow |
| 8 | Control tie-outs view (WHT log ↔ GL, intercompany symmetry) on Governance | ✅ | `0032`, Governance page |
| 9 | MFA: TOTP enrollment at Account → Security; approvals & signatures require AAL2 once enrolled (soft enforcement) | ✅ | `components/security/MfaManager.tsx`, `lib/auth.ts` |
| 10 | **Bonus bug fix:** exact giver matches were buried below fuzzy NULL rows (`order by is_exact desc` puts NULLs first) — the dedupe engine silently failed at scale | ✅ | `0033_fix_giver_match_ordering.sql` |

**Still open in Phase 2 (needs owner action):** set `PAYSTACK_SECRET_KEY`
(+ webhook URL in the Paystack dashboard), `MONO_SECRET_KEY` (+ create
bank-feed connections), and decide the email posture (Resend vs org SMTP).
Pledge↔AR control tie-out deferred until pledges post to an AR control
account (accrual recognition decision for the board/auditor).

## Phase 3 — Scale & polish (core built July 2026)

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 1 | `audit_log` partitioned by month (was 86% of the DB); nightly job pre-creates next month's partition; default partition as safety net | ✅ | `0034_audit_log_partitioning.sql` |
| 2 | Drill-down report writer: trial balance → account ledger → entry detail (lines, FX, provenance, reversal links, source documents) | ✅ | `0035_trial_balance.sql`, `/reports/trial-balance`, `/reports/ledger/[id]`, `/reports/entry/[id]` |
| 3 | Keyboard-first batch giving grid (Enter = next row; per-row idempotent commit; giver identity engine per row) | ✅ | `/givings/batch` |
| 4 | Optimistic approvals queue (instant decisions, server reconciliation, inline MFA/SoD errors) | ✅ | `ApprovalsQueue.tsx`, `decideApprovalDirect` |
| 5 | Outbox-backlog self-alerting (super admins pinged in-app when messages queue > 24h) | ✅ | `run_nightly_jobs` (0034) |

**Remaining Phase 3 backlog:**
- Materialized/incremental dashboard aggregates (only worth it once row counts
  hurt again — `amount_ngn` removed the hot spot).
- Budget versions/scenarios and rolling forecast.
- Accessible primitives sweep (Radix/React Aria for modals/menus), dark mode, i18n.
- Error tracking (Sentry) + external uptime checks.
