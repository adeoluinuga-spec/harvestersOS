-- ===========================================================================
-- Harvesters Finance OS — 0021 Weekly income reports + notification outbox
-- Schema for the automated Tuesday income report (per-campus weekly giving,
-- monthly by weeks, year target vs achieved, AI narrative + interpretation),
-- delivered in-app to campus pastors with sub-group/group visibility.
-- Plus a provider-agnostic message outbox (email / SMS / WhatsApp via Termii):
-- messages queue without keys and deliver once configured.
-- ===========================================================================

do $$ begin create type public.message_channel as enum ('email','sms','whatsapp');
exception when duplicate_object then null; end $$;

-- --- Weekly income reports ---------------------------------------------------
-- (Fresh feature; table is safe to recreate to converge on the final shape.)
drop view if exists public.weekly_income_report_inbox;
drop table if exists public.weekly_income_reports;

create table public.weekly_income_reports (
  id             uuid primary key default gen_random_uuid(),
  entity_id      uuid not null references public.entities(id) on delete cascade,
  week_start     date not null,            -- Monday
  week_end       date not null,            -- Sunday
  generated_data jsonb not null,           -- computed report payload
  ai_narrative   text,                     -- AI-prepared summary
  ai_analysis    text,                     -- strategic + pastoral interpretation
  generated_by   uuid references auth.users(id),
  sent_by        uuid references auth.users(id),
  sent_at        timestamptz,
  recipients     uuid[] not null default '{}',
  created_at     timestamptz not null default now(),
  unique (entity_id, week_start)
);
create index idx_wir_entity on public.weekly_income_reports(entity_id);
create index idx_wir_week on public.weekly_income_reports(week_start);

create view public.weekly_income_report_inbox with (security_invoker = true) as
  select r.id, r.entity_id, e.name as entity_name, r.week_start, r.week_end,
         r.generated_data, r.ai_narrative, r.ai_analysis,
         r.generated_by, r.sent_by, r.sent_at, r.recipients, r.created_at
  from public.weekly_income_reports r
  join public.entities e on e.id = r.entity_id;

-- --- Message outbox (Termii / email) ----------------------------------------
create table if not exists public.message_outbox (
  id                  uuid primary key default gen_random_uuid(),
  channel             public.message_channel not null,
  to_contact          text,                 -- email address or phone (nullable: queued until known)
  to_user_id          uuid references auth.users(id),
  subject             text,
  body                text not null,
  kind                text,                 -- approval_decision | approval_nudge | income_report | ...
  context             jsonb,
  entity_id           uuid references public.entities(id) on delete set null,
  status              public.email_status not null default 'queued',
  attempts            int not null default 0,
  provider_message_id text,
  error               text,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index if not exists idx_mo_status on public.message_outbox(status);
create index if not exists idx_mo_kind on public.message_outbox(kind);

-- --- Audit + RLS -------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['weekly_income_reports','message_outbox'] loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format(
      'create trigger trg_audit after insert or update or delete on public.%I
         for each row execute function app_private.tg_audit()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

drop policy if exists wir_select on public.weekly_income_reports;
create policy wir_select on public.weekly_income_reports for select to authenticated
  using (public.user_can_access_entity(entity_id) or auth.uid() = any(recipients));

drop policy if exists mo_select on public.message_outbox;
create policy mo_select on public.message_outbox for select to authenticated
  using (to_user_id = auth.uid() or created_by = auth.uid() or public.is_super_admin());
