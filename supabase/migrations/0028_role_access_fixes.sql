-- ===========================================================================
-- Harvesters Finance OS — 0028 Role access fixes (follow-up to 0026)
--
-- 1. auth.users: Supabase does not let the postgres role grant on the auth
--    schema, so hfos_app could not read user emails for pickers/joins.
--    public.app_users is an owner-check view (NOT security_invoker) that
--    exposes exactly id/email/created_at — nothing else from auth — and is
--    granted to hfos_app only (browser roles get nothing).
-- 2. Analytics views are security_invoker=true (so RLS applies to direct
--    client reads). For hfos_ai that means privileges are checked as hfos_ai
--    on the UNDERLYING tables. Resolve the views' table closure and give
--    hfos_ai SELECT + a read-only RLS pass on exactly those tables — the
--    fence is the explicit dependency set, still no writes, no auth schema,
--    10s timeout, forced read-only.
-- ===========================================================================

-- --- 1. app_users owner view ------------------------------------------------
drop view if exists public.app_users;
create view public.app_users as
  select id, email, created_at from auth.users;

revoke all on public.app_users from public, anon, authenticated;
grant select on public.app_users to hfos_app, service_role;

comment on view public.app_users is
  'Owner-check view over auth.users (id/email only) so the least-privilege app role can resolve user emails without auth-schema grants. Not exposed to client roles.';

-- --- 2. hfos_ai: grant the dependency closure of the approved views ---------
do $$
declare
  r record;
begin
  for r in
    with recursive deps as (
      -- direct dependencies of the approved analytics views
      select vtu.table_schema, vtu.table_name
      from information_schema.view_table_usage vtu
      where vtu.view_schema = 'public'
        and vtu.view_name in (
          'analytics_giving_monthly','analytics_giving_yoy',
          'analytics_giving_seasonality','analytics_giving_velocity_alerts',
          'analytics_hni_givers','analytics_lapsed_major_givers',
          'analytics_cash_flow_forecast','analytics_expense_anomaly_flags',
          'budget_vs_actual_rollup')
      union
      -- expand views-of-views down to base tables
      select vtu2.table_schema, vtu2.table_name
      from deps d
      join information_schema.view_table_usage vtu2
        on vtu2.view_schema = d.table_schema and vtu2.view_name = d.table_name
    )
    select distinct d.table_schema, d.table_name, c.relkind, c.relrowsecurity
    from deps d
    join pg_class c on c.relname = d.table_name
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = d.table_schema
    where d.table_schema = 'public'
  loop
    execute format('grant select on %I.%I to hfos_ai', r.table_schema, r.table_name);
    if r.relkind = 'r' and r.relrowsecurity then
      execute format('drop policy if exists hfos_ai_ro on %I.%I', r.table_schema, r.table_name);
      execute format(
        'create policy hfos_ai_ro on %I.%I for select to hfos_ai using (true)',
        r.table_schema, r.table_name);
    end if;
  end loop;
end $$;

-- fx_rate_at & co. are called inside the views.
grant usage on schema extensions to hfos_ai;
grant execute on all functions in schema public to hfos_ai;
