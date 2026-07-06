-- ===========================================================================
-- Harvesters Finance OS — 0031 Online giving ingestion
--
-- Payment-processor webhooks (Paystack first; Flutterwave-ready) land in an
-- event inbox, then a processor function turns each successful charge into a
-- REAL gift: giver resolved by exact email/phone (the same identity engine
-- clerks use), giving record inserted, journal entry posted, reconciliation
-- marked — untouched by human hands. Anything ambiguous (no exact giver
-- match, unknown campus) waits in a review queue instead of guessing.
-- Idempotent end-to-end: processors retry webhooks; (provider, event id) is
-- unique, and processing an already-recorded event is a no-op.
-- ===========================================================================

do $$ begin create type public.online_payment_status as enum
  ('received','recorded','needs_review','ignored','failed');
exception when duplicate_object then null; end $$;

create table if not exists public.online_payment_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null check (provider in ('paystack','flutterwave')),
  event_id          text not null,          -- provider's unique id / reference
  event_type        text not null,          -- e.g. charge.success
  reference         text,
  amount            numeric(18,2),
  currency          char(3),
  paid_at           timestamptz,
  payer_email       text,
  payer_phone       text,
  payer_name        text,
  entity_id         uuid references public.entities(id),   -- from metadata.entity_id
  giving_type_code  text,                                    -- from metadata.giving_type
  status            public.online_payment_status not null default 'received',
  giving_record_id  uuid references public.giving_records(id),
  error             text,
  raw               jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  processed_at      timestamptz,
  unique (provider, event_id)
);
create index if not exists idx_ope_status on public.online_payment_events(status);
create index if not exists idx_ope_entity on public.online_payment_events(entity_id);

-- ---------------------------------------------------------------------------
-- Processor: one event -> one posted gift (or the review queue).
-- p_giver_id lets a human resolve a needs_review event explicitly.
-- ---------------------------------------------------------------------------
create or replace function public.process_online_payment(
  p_event_id uuid,
  p_giver_id uuid default null,
  p_actor uuid default null
) returns public.online_payment_status
language plpgsql volatile security definer set search_path = '' as $$
declare
  ev public.online_payment_events;
  v_giver uuid := p_giver_id;
  v_type uuid;
  v_gr uuid;
  m record;
begin
  select * into ev from public.online_payment_events where id = p_event_id for update;
  if not found then raise exception 'Event not found' using errcode = 'check_violation'; end if;
  if ev.status = 'recorded' then return ev.status; end if;              -- idempotent
  if ev.event_type not in ('charge.success','transfer.success') then
    update public.online_payment_events set status = 'ignored', processed_at = now()
     where id = p_event_id;
    return 'ignored';
  end if;

  -- Campus is required: without it the gift cannot be attributed or posted.
  if ev.entity_id is null then
    update public.online_payment_events
       set status = 'needs_review', error = 'No campus (metadata.entity_id) on the payment', processed_at = now()
     where id = p_event_id;
    return 'needs_review';
  end if;

  -- Giving type: metadata code, defaulting to offering.
  select id into v_type from public.giving_types
   where code = coalesce(nullif(ev.giving_type_code, ''), 'offering') and is_active;
  if v_type is null then
    select id into v_type from public.giving_types where code = 'offering';
  end if;

  -- Giver: explicit (human resolution) or EXACT identifier match only.
  if v_giver is null then
    select giver_id into v_giver
    from public.find_giver_matches(coalesce(ev.payer_name, ''), ev.payer_phone, ev.payer_email, 3) fm
    where fm.is_exact limit 1;
  end if;
  if v_giver is null then
    update public.online_payment_events
       set status = 'needs_review', error = 'No exact giver match for payer email/phone', processed_at = now()
     where id = p_event_id;
    return 'needs_review';
  end if;

  insert into public.giving_records
    (giver_id, entity_id, recording_entity_id, attribution_entity_id, giving_type_id,
     amount, currency, channel, transaction_date, recorded_by, note, reconciliation_status)
  values
    (v_giver, ev.entity_id, ev.entity_id, ev.entity_id, v_type,
     ev.amount, coalesce(ev.currency, 'NGN'), 'online_paystack',
     coalesce(ev.paid_at::date, current_date), p_actor,
     'Online payment ' || ev.provider || ' ' || coalesce(ev.reference, ev.event_id),
     'matched')                                   -- processor-settled: reconciled at source
  returning id into v_gr;

  perform public.post_giving_record(v_gr);

  update public.online_payment_events
     set status = 'recorded', giving_record_id = v_gr, error = null, processed_at = now()
   where id = p_event_id;
  return 'recorded';
exception when others then
  update public.online_payment_events
     set status = 'failed', error = sqlerrm, processed_at = now()
   where id = p_event_id;
  return 'failed';
end $$;
revoke all on function public.process_online_payment(uuid, uuid, uuid) from public, anon, authenticated;

-- --- RLS, grants, audit ------------------------------------------------------
alter table public.online_payment_events enable row level security;
revoke all on public.online_payment_events from anon, authenticated;
grant select on public.online_payment_events to authenticated;
grant all on public.online_payment_events to service_role;

drop policy if exists ope_select on public.online_payment_events;
create policy ope_select on public.online_payment_events for select to authenticated
  using (entity_id is null or public.user_can_access_entity(entity_id));

drop policy if exists hfos_app_rw on public.online_payment_events;
create policy hfos_app_rw on public.online_payment_events for all to hfos_app
  using (true) with check (true);

drop trigger if exists trg_audit on public.online_payment_events;
create trigger trg_audit after insert or update or delete on public.online_payment_events
  for each row execute function app_private.tg_audit();
