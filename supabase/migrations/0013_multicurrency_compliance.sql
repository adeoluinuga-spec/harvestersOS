-- ===========================================================================
-- Harvesters Finance OS - 0013 Multi-currency and cross-border compliance
-- Historical FX capture, NGN consolidation with CTA, statutory reporting,
-- cross-border transfer compliance, and diaspora giving attribution.
-- ===========================================================================

do $$ begin create type public.cross_border_direction as enum
  ('hq_to_international','international_to_hq');
exception when duplicate_object then null; end $$;

do $$ begin create type public.cross_border_purpose as enum
  ('seed_funding','covering_remittance','missions_support','other');
exception when duplicate_object then null; end $$;

do $$ begin create type public.cross_border_compliance_status as enum
  ('pending_review','documented','flagged');
exception when duplicate_object then null; end $$;

alter table public.entities
  add column if not exists statutory_jurisdiction text;

update public.entities
   set statutory_jurisdiction = case
     when legal_status = 'separate_foreign_entity' then coalesce(nullif(statutory_jurisdiction, ''), country)
     else statutory_jurisdiction
   end;

update public.entities
   set legal_status = 'separate_foreign_entity',
       statutory_jurisdiction = coalesce(statutory_jurisdiction, country)
 where functional_currency <> 'NGN'
   and type in ('sub_group','campus');

create table if not exists public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  currency_pair text not null,
  rate numeric(20,10) not null check (rate > 0),
  effective_date date not null,
  source text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (currency_pair, effective_date, source),
  constraint fx_pair_format check (currency_pair ~ '^[A-Z]{3}/[A-Z]{3}$')
);
create index if not exists idx_fx_rates_lookup on public.fx_rates(currency_pair, effective_date desc);

insert into public.fx_rates (currency_pair, rate, effective_date, source)
values
  ('NGN/NGN', 1, date '2000-01-01', 'system'),
  ('GBP/NGN', 1900, date '2000-01-01', 'opening_seed'),
  ('USD/NGN', 1500, date '2000-01-01', 'opening_seed')
on conflict (currency_pair, effective_date, source) do nothing;

create or replace function app_private.tg_fx_rates_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'FX rates are immutable; insert a new effective_date rate instead'
    using errcode = 'check_violation';
end $$;
drop trigger if exists trg_fx_rates_immutable_update on public.fx_rates;
create trigger trg_fx_rates_immutable_update
  before update or delete on public.fx_rates
  for each row execute function app_private.tg_fx_rates_immutable();

create or replace function public.fx_rate_at(
  p_currency text,
  p_presentation_currency text,
  p_effective_date date
) returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  v_pair text := upper(p_currency) || '/' || upper(p_presentation_currency);
  v_rate numeric(20,10);
begin
  if upper(p_currency) = upper(p_presentation_currency) then
    return 1;
  end if;

  select rate into v_rate
  from public.fx_rates
  where currency_pair = v_pair
    and effective_date <= p_effective_date
  order by effective_date desc, created_at desc
  limit 1;

  if v_rate is null then
    raise exception 'No FX rate configured for % on or before %', v_pair, p_effective_date
      using errcode = 'check_violation';
  end if;
  return v_rate;
end $$;
grant execute on function public.fx_rate_at(text,text,date) to authenticated, service_role;

create or replace function app_private.tg_capture_jel_fx()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_date date;
begin
  select transaction_date into v_date
  from public.journal_entries
  where id = new.journal_entry_id;

  if new.fx_rate_to_presentation_currency is null
     or new.fx_rate_to_presentation_currency = 1 then
    new.fx_rate_to_presentation_currency :=
      public.fx_rate_at(new.currency::text, 'NGN', coalesce(v_date, current_date));
  end if;
  return new;
end $$;
drop trigger if exists trg_capture_jel_fx on public.journal_entry_lines;
create trigger trg_capture_jel_fx
  before insert on public.journal_entry_lines
  for each row execute function app_private.tg_capture_jel_fx();

alter table public.giving_records
  add column if not exists recording_entity_id uuid references public.entities(id) on delete restrict,
  add column if not exists attribution_entity_id uuid references public.entities(id) on delete restrict;

update public.giving_records
   set recording_entity_id = coalesce(recording_entity_id, entity_id),
       attribution_entity_id = coalesce(attribution_entity_id, entity_id);

alter table public.giving_records
  alter column recording_entity_id set not null,
  alter column attribution_entity_id set not null;

create index if not exists idx_gr_recording_entity on public.giving_records(recording_entity_id);
create index if not exists idx_gr_attribution_entity on public.giving_records(attribution_entity_id);

comment on column public.giving_records.entity_id is
  'Backward-compatible legal receiving entity. New code also writes recording_entity_id to the same value.';
comment on column public.giving_records.recording_entity_id is
  'Entity where the gift was legally received/receipted.';
comment on column public.giving_records.attribution_entity_id is
  'Entity/ministry the gift is attributed to for ministry reporting.';

create or replace function public.post_giving_record(p_giving_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  g            public.giving_records;
  v_credit     uuid;
  v_fund       public.fund_classification;
  v_debit      uuid;
  v_type_name  text;
  v_je         uuid;
begin
  select * into g from public.giving_records where id = p_giving_id;
  if not found then
    raise exception 'Giving record % not found', p_giving_id using errcode = 'check_violation';
  end if;
  if g.journal_entry_id is not null then
    raise exception 'Giving record % is already posted', p_giving_id using errcode = 'check_violation';
  end if;

  select default_account_id, default_fund_classification, name
    into v_credit, v_fund, v_type_name
  from public.giving_types where id = g.giving_type_id;

  select id into v_debit from public.accounts
  where code = case when g.channel = 'cash' then '1000' else '1010' end;

  insert into public.journal_entries
    (entity_id, transaction_date, description, source_module, created_by, status)
  values
    (g.recording_entity_id, g.transaction_date, 'Giving: ' || v_type_name, 'giving', g.recorded_by, 'draft')
  returning id into v_je;

  insert into public.journal_entry_lines
    (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
  values
    (v_je, v_debit,  g.recording_entity_id, g.amount, 0, v_fund, g.currency),
    (v_je, v_credit, g.recording_entity_id, 0, g.amount, v_fund, g.currency);

  update public.journal_entries set status = 'posted' where id = v_je;
  update public.giving_records set journal_entry_id = v_je where id = p_giving_id;
  return v_je;
end $$;
revoke all on function public.post_giving_record(uuid) from public, anon, authenticated;

create table if not exists public.cross_border_transfers (
  id uuid primary key default gen_random_uuid(),
  sending_entity_id uuid not null references public.entities(id) on delete restrict,
  receiving_entity_id uuid not null references public.entities(id) on delete restrict,
  direction public.cross_border_direction not null,
  purpose public.cross_border_purpose not null,
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null,
  supporting_documentation_url text,
  compliance_status public.cross_border_compliance_status not null default 'pending_review',
  requested_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint cross_border_entities_distinct check (sending_entity_id <> receiving_entity_id),
  constraint cross_border_doc_required check (
    compliance_status = 'pending_review'
    or (supporting_documentation_url is not null and length(trim(supporting_documentation_url)) > 0)
  ),
  constraint cross_border_approval_required check (
    compliance_status = 'pending_review'
    or approved_by is not null
  )
);
create index if not exists idx_cross_border_status on public.cross_border_transfers(compliance_status, created_at desc);
create index if not exists idx_cross_border_sending on public.cross_border_transfers(sending_entity_id);
create index if not exists idx_cross_border_receiving on public.cross_border_transfers(receiving_entity_id);

create or replace function public.consolidated_statement_ngn(
  p_start_date date,
  p_end_date date,
  p_period_end_rate_date date default null
) returns table (
  row_type text,
  entity_id uuid,
  entity_name text,
  account_id uuid,
  account_code text,
  account_name text,
  account_type public.account_type,
  functional_currency char(3),
  historical_debit_ngn numeric,
  historical_credit_ngn numeric,
  net_historical_ngn numeric,
  period_end_revalued_ngn numeric,
  currency_translation_adjustment_ngn numeric
) language sql stable security invoker set search_path = '' as $$
  with period_lines as (
    select jel.*, je.transaction_date, e.name as entity_name, e.functional_currency,
           a.code, a.name as account_name, a.account_type
    from public.journal_entry_lines jel
    join public.journal_entries je on je.id = jel.journal_entry_id
    join public.entities e on e.id = jel.entity_id
    join public.accounts a on a.id = jel.account_id
    where je.status = 'posted'
      and je.transaction_date between p_start_date and p_end_date
  ),
  actuals as (
    select 'actual'::text as row_type,
           entity_id,
           entity_name,
           account_id,
           code as account_code,
           account_name,
           account_type,
           functional_currency,
           sum(round(debit_amount * fx_rate_to_presentation_currency, 2)) as historical_debit_ngn,
           sum(round(credit_amount * fx_rate_to_presentation_currency, 2)) as historical_credit_ngn,
           sum(round((debit_amount - credit_amount) * fx_rate_to_presentation_currency, 2)) as net_historical_ngn,
           null::numeric as period_end_revalued_ngn,
           null::numeric as currency_translation_adjustment_ngn
    from period_lines
    group by entity_id, entity_name, account_id, code, account_name, account_type, functional_currency
  ),
  balances as (
    select jel.entity_id, e.name as entity_name, jel.account_id, a.code as account_code,
           a.name as account_name, a.account_type, e.functional_currency,
           jel.currency,
           sum(jel.debit_amount - jel.credit_amount) as balance_native,
           sum(round((jel.debit_amount - jel.credit_amount) * jel.fx_rate_to_presentation_currency, 2)) as historical_ngn
    from public.journal_entry_lines jel
    join public.journal_entries je on je.id = jel.journal_entry_id
    join public.entities e on e.id = jel.entity_id
    join public.accounts a on a.id = jel.account_id
    where je.status = 'posted'
      and je.transaction_date <= p_end_date
      and a.account_type in ('asset','liability','equity')
    group by jel.entity_id, e.name, jel.account_id, a.code, a.name, a.account_type, e.functional_currency, jel.currency
  ),
  cta as (
    select 'translation_adjustment'::text as row_type,
           entity_id,
           entity_name,
           account_id,
           account_code,
           account_name,
           account_type,
           functional_currency,
           null::numeric as historical_debit_ngn,
           null::numeric as historical_credit_ngn,
           historical_ngn as net_historical_ngn,
           round(balance_native * public.fx_rate_at(currency::text, 'NGN', coalesce(p_period_end_rate_date, p_end_date)), 2)
             as period_end_revalued_ngn,
           round(balance_native * public.fx_rate_at(currency::text, 'NGN', coalesce(p_period_end_rate_date, p_end_date)), 2)
             - historical_ngn as currency_translation_adjustment_ngn
    from balances
    where currency <> 'NGN'
  )
  select * from actuals
  union all
  select * from cta;
$$;
grant execute on function public.consolidated_statement_ngn(date,date,date) to authenticated, service_role;

create or replace function public.statutory_statement(
  p_entity_id uuid,
  p_start_date date,
  p_end_date date
) returns table (
  entity_id uuid,
  entity_name text,
  statutory_jurisdiction text,
  account_code text,
  account_name text,
  account_type public.account_type,
  currency char(3),
  debit_amount numeric,
  credit_amount numeric,
  net_amount numeric
) language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.entities
    where id = p_entity_id and legal_status = 'separate_foreign_entity'
  ) then
    raise exception 'Statutory view requires one separate_foreign_entity'
      using errcode = 'check_violation';
  end if;

  return query
  select e.id, e.name, e.statutory_jurisdiction, a.code, a.name, a.account_type,
         jel.currency,
         sum(jel.debit_amount), sum(jel.credit_amount),
         sum(jel.debit_amount - jel.credit_amount)
  from public.journal_entry_lines jel
  join public.journal_entries je on je.id = jel.journal_entry_id
  join public.entities e on e.id = jel.entity_id
  join public.accounts a on a.id = jel.account_id
  where je.status = 'posted'
    and jel.entity_id = p_entity_id
    and je.transaction_date between p_start_date and p_end_date
  group by e.id, e.name, e.statutory_jurisdiction, a.code, a.name, a.account_type, jel.currency
  order by a.code;
end $$;
grant execute on function public.statutory_statement(uuid,date,date) to authenticated, service_role;

create or replace function public.record_partnership_payment(
  p_commitment_id uuid,
  p_amount numeric,
  p_currency text,
  p_channel public.giving_channel,
  p_transaction_date date,
  p_recorded_by uuid default null,
  p_note text default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  c record;
  v_type uuid;
  v_giving uuid;
begin
  select pc.id, pc.partner_id, p.giver_id, p.entity_id
    into c
  from public.partnership_commitments pc
  join public.partners p on p.id = pc.partner_id
  where pc.id = p_commitment_id and pc.is_active;

  if not found then
    raise exception 'Active partnership commitment not found' using errcode = 'check_violation';
  end if;

  select id into v_type from public.giving_types where code = 'partnership' and is_active;
  if v_type is null then
    raise exception 'Partnership giving type is not configured' using errcode = 'check_violation';
  end if;

  insert into public.giving_records
    (giver_id, entity_id, recording_entity_id, attribution_entity_id, giving_type_id,
     amount, currency, channel, transaction_date, recorded_by, note)
  values
    (c.giver_id, c.entity_id, c.entity_id, c.entity_id, v_type, p_amount,
     upper(p_currency)::char(3), p_channel, p_transaction_date, p_recorded_by, p_note)
  returning id into v_giving;

  perform public.post_giving_record(v_giving);

  insert into public.partnership_fulfillments
    (commitment_id, giving_record_id, amount, fulfilled_month)
  values
    (p_commitment_id, v_giving, p_amount, date_trunc('month', p_transaction_date)::date);

  update public.partnership_lapse_flags
     set status = 'resolved', resolved_at = now()
   where commitment_id = p_commitment_id and status = 'open';

  update public.partners
     set status = 'active'
   where id = c.partner_id and status = 'lapsed';

  return v_giving;
end $$;
revoke all on function public.record_partnership_payment(uuid,numeric,text,public.giving_channel,date,uuid,text)
  from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['fx_rates','cross_border_transfers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function app_private.tg_audit()', t);
  end loop;
end $$;

drop policy if exists fx_rates_select on public.fx_rates;
create policy fx_rates_select on public.fx_rates for select to authenticated using (true);

drop policy if exists cross_border_transfers_select on public.cross_border_transfers;
create policy cross_border_transfers_select on public.cross_border_transfers for select to authenticated
  using (
    public.user_can_access_entity(sending_entity_id)
    or public.user_can_access_entity(receiving_entity_id)
  );

drop policy if exists giving_records_select on public.giving_records;
create policy giving_records_select on public.giving_records for select to authenticated
  using (
    public.user_can_access_entity(entity_id)
    or public.user_can_access_entity(recording_entity_id)
    or public.user_can_access_entity(attribution_entity_id)
  );
