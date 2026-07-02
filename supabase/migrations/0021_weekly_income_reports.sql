-- ===========================================================================
-- Harvesters Finance OS - 0021 Weekly income reports
-- In-app Tuesday-style campus income reports with AI narrative snapshots.
-- ===========================================================================

create table if not exists public.weekly_income_reports (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  week_start date not null,
  week_end date not null,
  generated_data jsonb not null,
  ai_narrative text,
  ai_analysis text,
  generated_by uuid references auth.users(id) on delete set null,
  sent_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  recipients uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  constraint weekly_income_week_valid check (week_end >= week_start),
  unique (entity_id, week_start)
);

create index if not exists idx_weekly_income_reports_entity_week
  on public.weekly_income_reports(entity_id, week_start desc);
create index if not exists idx_weekly_income_reports_sent
  on public.weekly_income_reports(sent_at desc) where sent_at is not null;

create or replace view public.weekly_income_report_inbox with (security_invoker = true) as
select wir.id,
       wir.entity_id,
       e.name as entity_name,
       e.type as entity_type,
       wir.week_start,
       wir.week_end,
       wir.generated_data,
       wir.ai_narrative,
       wir.ai_analysis,
       wir.generated_by,
       wir.sent_by,
       wir.sent_at,
       wir.recipients,
       wir.created_at
from public.weekly_income_reports wir
join public.entities e on e.id = wir.entity_id;

do $$
begin
  alter table public.weekly_income_reports enable row level security;
  revoke all on public.weekly_income_reports from anon, authenticated;
  grant select on public.weekly_income_reports to authenticated;
  grant all on public.weekly_income_reports to service_role;
  grant select on public.weekly_income_report_inbox to authenticated, service_role;
end $$;

drop policy if exists weekly_income_reports_select on public.weekly_income_reports;
create policy weekly_income_reports_select on public.weekly_income_reports for select to authenticated
  using (
    public.user_can_access_entity(entity_id)
    or auth.uid() = any(recipients)
    or generated_by = auth.uid()
    or sent_by = auth.uid()
    or public.is_super_admin()
  );

drop trigger if exists trg_audit on public.weekly_income_reports;
create trigger trg_audit after insert or update or delete on public.weekly_income_reports
  for each row execute function app_private.tg_audit();
