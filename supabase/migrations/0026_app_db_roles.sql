-- ===========================================================================
-- Harvesters Finance OS — 0026 Least-privilege database roles
--
-- The app previously connected as the database OWNER (postgres): any SQL
-- injection anywhere would have been total compromise, and the app could in
-- principle run DDL. Two dedicated login roles fix that:
--
--   • hfos_app — the Next.js server. DML on public tables, execute on the
--     sanctioned functions, SELECT on auth.users (pickers/audit joins).
--     NO ddl, NO trigger control, NO role management. Statement-timeout
--     bounded. Ledger triggers still fire for it, of course.
--   • hfos_ai  — the "Ask the ledger" AI runner. SELECT on the approved
--     analytics views ONLY, forced read-only transactions, 10s timeout.
--     Even a fully jail-broken generated query cannot write or exfiltrate
--     beyond the reporting views.
--
-- Passwords are NOT set here (migrations live in git). Run
--   node --env-file=.env.local scripts/provision-db-roles.mjs
-- once per environment to set passwords and write APP_DATABASE_URL /
-- AI_DATABASE_URL into .env.local. Until then the app falls back to
-- DATABASE_URL and nothing breaks.
-- ===========================================================================

-- --- Roles (no password yet => cannot log in until provisioned) -------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'hfos_app') then
    create role hfos_app login;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'hfos_ai') then
    create role hfos_ai login;
  end if;
end $$;

-- --- Timeouts / safety valves ------------------------------------------------
alter role hfos_app set statement_timeout = '20s';
alter role hfos_app set idle_in_transaction_session_timeout = '30s';
alter role hfos_ai  set statement_timeout = '10s';
alter role hfos_ai  set idle_in_transaction_session_timeout = '10s';
alter role hfos_ai  set default_transaction_read_only = on;

-- --- hfos_app grants ----------------------------------------------------------
grant usage on schema public, app_private, extensions to hfos_app;
grant usage on schema auth to hfos_app;
grant select on auth.users to hfos_app;

grant select, insert, update, delete on all tables in schema public to hfos_app;
grant usage, select on all sequences in schema public to hfos_app;
grant execute on all functions in schema public to hfos_app;
grant execute on all functions in schema app_private to hfos_app;

-- Future objects created by the owner get the same grants automatically.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to hfos_app;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to hfos_app;
alter default privileges for role postgres in schema public
  grant execute on functions to hfos_app;
alter default privileges for role postgres in schema app_private
  grant execute on functions to hfos_app;

-- Migration bookkeeping stays owner-only.
revoke all on public.schema_migrations from hfos_app;

-- RLS: hfos_app is scoped by the APPLICATION (accessible_entity_ids threaded
-- through every query), same trust model as before, minus DDL power. Give it
-- an explicit pass on every RLS-enabled public table; new tables get their
-- policy when their migration runs (or via re-running this loop).
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname <> 'schema_migrations'
  loop
    execute format('drop policy if exists hfos_app_rw on public.%I', t.relname);
    execute format(
      'create policy hfos_app_rw on public.%I for all to hfos_app using (true) with check (true)',
      t.relname);
  end loop;
end $$;

-- --- hfos_ai grants ------------------------------------------------------------
grant usage on schema public to hfos_ai;
grant select on public.analytics_giving_monthly,
                public.analytics_giving_yoy,
                public.analytics_giving_seasonality,
                public.analytics_giving_velocity_alerts,
                public.analytics_hni_givers,
                public.analytics_lapsed_major_givers,
                public.analytics_cash_flow_forecast,
                public.analytics_expense_anomaly_flags,
                public.budget_vs_actual_rollup
  to hfos_ai;
