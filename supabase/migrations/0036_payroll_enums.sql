-- ===========================================================================
-- Harvesters Finance OS — 0036 Payroll workflow enums
-- Own file: values added to an existing enum cannot be used until the
-- transaction that added them commits (the runner executes each file as one
-- transaction). The workflow itself lands in 0037.
-- ===========================================================================

-- Central HR prepares payroll; grantable at central office, a group, or a
-- ministry, cascading down the tree like every other scoped role.
alter type public.app_role add value if not exists 'hr_officer';

-- Runs now travel draft -> pending_approval -> approved (accrual posts,
-- batches spawn) -> paid; a pastor/head can send one back as rejected.
alter type public.payroll_run_status add value if not exists 'pending_approval';
alter type public.payroll_run_status add value if not exists 'rejected';
