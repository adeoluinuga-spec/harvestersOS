-- ===========================================================================
-- Harvesters Finance OS — 0034 Partition the audit log by month
--
-- The audit log is by far the largest object in the database (every write on
-- every table lands here with before/after JSON). Converting it to monthly
-- RANGE partitions keeps writes fast forever, lets old months be archived or
-- dropped as policy allows, and keeps backups/vacuum proportional to the hot
-- month instead of all history. The table name, columns, trigger behaviour,
-- RLS and grants are unchanged — callers cannot tell the difference.
-- ===========================================================================

-- --- 1. Move the existing table aside ---------------------------------------
alter table public.audit_log rename to audit_log_unpartitioned;

-- --- 2. Recreate as a partitioned table --------------------------------------
-- (Explicit sequence rather than IDENTITY for maximum compatibility with
-- partitioned parents; primary key must include the partition column.)
create sequence if not exists public.audit_log_seq;

create table public.audit_log (
  id          bigint not null default nextval('public.audit_log_seq'),
  occurred_at timestamptz not null default now(),
  actor_id    uuid,
  action      text not null,
  table_name  text not null,
  record_id   text,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  note        text,
  primary key (id, occurred_at)
) partition by range (occurred_at);

alter sequence public.audit_log_seq owned by public.audit_log.id;

comment on table public.audit_log is
  'Append-only audit backbone, partitioned by month (audit_log_yYYYYmMM). Written automatically by app_private.tg_audit for every table.';

-- Safety net: a row can never be lost to a missing partition.
create table if not exists public.audit_log_default
  partition of public.audit_log default;

-- --- 3. Partition factory ------------------------------------------------------
create or replace function app_private.ensure_audit_partition(p_month date)
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := 'audit_log_y' || to_char(v_start, 'YYYY') || 'm' || to_char(v_start, 'MM');
begin
  if to_regclass('public.' || v_name) is null then
    execute format(
      'create table public.%I partition of public.audit_log
         for values from (%L) to (%L)', v_name, v_start, v_end);
  end if;
  return v_name;
end $$;

-- Partitions for every month present in the old data, plus this and next month.
do $$
declare m date;
begin
  for m in
    select distinct date_trunc('month', occurred_at)::date
    from public.audit_log_unpartitioned
    union
    select date_trunc('month', current_date)::date
    union
    select (date_trunc('month', current_date) + interval '1 month')::date
  loop
    perform app_private.ensure_audit_partition(m);
  end loop;
end $$;

-- --- 4. Copy history across, continue the id sequence, drop the old table -----
insert into public.audit_log
  (id, occurred_at, actor_id, action, table_name, record_id, entity_id, before, after, note)
select id, occurred_at, actor_id, action, table_name, record_id, entity_id, before, after, note
from public.audit_log_unpartitioned;

select setval('public.audit_log_seq',
              coalesce((select max(id) from public.audit_log), 0) + 1, false);

drop table public.audit_log_unpartitioned;

-- --- 5. Indexes (created on every partition automatically) ---------------------
create index if not exists idx_audit_entity on public.audit_log(entity_id);
create index if not exists idx_audit_actor on public.audit_log(actor_id);
create index if not exists idx_audit_time on public.audit_log(occurred_at);
create index if not exists idx_audit_record on public.audit_log(table_name, record_id);

-- --- 6. RLS, grants, policies (same posture as before) --------------------------
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;
grant select, insert on public.audit_log to hfos_app;
grant usage, select on sequence public.audit_log_seq to hfos_app;

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (public.is_super_admin() or public.is_auditor());

drop policy if exists hfos_app_rw on public.audit_log;
create policy hfos_app_rw on public.audit_log for all to hfos_app
  using (true) with check (true);

-- --- 7. Nightly upkeep: always keep next month's partition ready ----------------
create or replace function public.run_nightly_jobs()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_esc int; v_mat int; v_dep jsonb; v_part text; v_backlog int;
begin
  v_esc := public.escalate_stale_approvals(3);
  v_mat := public.notify_upcoming_maturities(14);
  begin
    perform public.refresh_investment_maturity_alerts(120);
    perform public.detect_lapsed_partners(current_date);
  exception when undefined_function then null; end;
  begin
    v_dep := public.run_monthly_depreciation();
  exception when others then
    v_dep := jsonb_build_object('error', sqlerrm);
  end;
  v_part := app_private.ensure_audit_partition(
    (date_trunc('month', current_date) + interval '1 month')::date);

  -- The system must notice before the accountant does: a growing outbox
  -- backlog (messages queued > 24h) pings the super admins in-app.
  select count(*)::int into v_backlog
  from public.message_outbox
  where status = 'queued' and created_at < now() - interval '24 hours';
  if v_backlog > 0 and not exists (
    select 1 from public.notifications
    where title = 'Message outbox backlog' and created_at > now() - interval '24 hours'
  ) then
    insert into public.notifications (user_id, role, entity_id, title, body, href)
    values (null, 'super_admin', null, 'Message outbox backlog',
            v_backlog || ' message(s) have been queued for over 24 hours. ' ||
            'Check provider keys (RESEND_API_KEY / TERMII_API_KEY) and the /api/jobs schedule.',
            '/governance');
  end if;

  return jsonb_build_object(
    'escalated_approvals', v_esc,
    'maturity_notifications', v_mat,
    'depreciation', v_dep,
    'next_audit_partition', v_part,
    'outbox_backlog', v_backlog,
    'ran_at', now());
end $$;
revoke all on function public.run_nightly_jobs() from public, anon, authenticated;
