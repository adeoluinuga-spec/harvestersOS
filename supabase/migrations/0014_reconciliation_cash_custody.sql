-- ===========================================================================
-- Harvesters Finance OS - 0014 Bank reconciliation and cash custody
-- Bank feed ingestion/matching, unreconciled controls, and physical cash
-- chain-of-custody with dual-counter enforcement.
-- ===========================================================================

do $$ begin create type public.bank_feed_provider as enum ('mono','okra','manual');
exception when duplicate_object then null; end $$;

do $$ begin create type public.bank_feed_transaction_status as enum
  ('unmatched','matched','ignored');
exception when duplicate_object then null; end $$;

do $$ begin create type public.reconciliation_match_type as enum ('auto','manual');
exception when duplicate_object then null; end $$;

do $$ begin create type public.cash_count_status as enum
  ('draft','finalized','variance_reviewed');
exception when duplicate_object then null; end $$;

create or replace function public.distinct_uuid_count(p_ids uuid[])
returns int language sql immutable set search_path = '' as $$
  select count(distinct x)::int from unnest(coalesce(p_ids, array[]::uuid[])) as x;
$$;

create table if not exists public.bank_feed_connections (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  provider public.bank_feed_provider not null,
  external_account_id text,
  access_token_secret_name text,
  last_synced_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (bank_account_id, provider)
);
create index if not exists idx_bank_feed_connections_bank on public.bank_feed_connections(bank_account_id, is_active);

create table if not exists public.bank_feed_transactions (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  provider public.bank_feed_provider not null,
  external_transaction_id text not null,
  transaction_date date not null,
  value_date date,
  amount numeric(18,2) not null,
  currency char(3) not null,
  description text,
  raw_payload jsonb not null default '{}'::jsonb,
  status public.bank_feed_transaction_status not null default 'unmatched',
  imported_at timestamptz not null default now(),
  unique (provider, external_transaction_id)
);
create index if not exists idx_bank_feed_tx_bank_status on public.bank_feed_transactions(bank_account_id, status, transaction_date);
create index if not exists idx_bank_feed_tx_age on public.bank_feed_transactions(status, imported_at);

create table if not exists public.reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  bank_feed_transaction_id uuid not null unique references public.bank_feed_transactions(id) on delete cascade,
  matched_journal_entry_line_id uuid not null unique references public.journal_entry_lines(id) on delete restrict,
  match_type public.reconciliation_match_type not null,
  matched_by uuid references auth.users(id),
  matched_at timestamptz not null default now()
);
create index if not exists idx_recon_matches_line on public.reconciliation_matches(matched_journal_entry_line_id);

create table if not exists public.reconciliation_settings (
  entity_id uuid primary key references public.entities(id) on delete cascade,
  stale_unreconciled_days int not null default 7 check (stale_unreconciled_days >= 1),
  unmatched_bank_tx_hours int not null default 48 check (unmatched_bank_tx_hours >= 1),
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_count_sessions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  service_date date not null,
  counted_by uuid[] not null,
  total_counted numeric(18,2) not null check (total_counted >= 0),
  currency char(3) not null default 'NGN',
  sealed_bag_reference text not null,
  status public.cash_count_status not null default 'finalized',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint cash_count_dual_counter check (
    cardinality(counted_by) >= 2 and public.distinct_uuid_count(counted_by) >= 2
  ),
  unique (entity_id, service_date, sealed_bag_reference)
);
create index if not exists idx_cash_count_entity_date on public.cash_count_sessions(entity_id, service_date desc);

create table if not exists public.cash_deposits (
  id uuid primary key default gen_random_uuid(),
  cash_count_session_id uuid not null references public.cash_count_sessions(id) on delete restrict,
  deposited_amount numeric(18,2) not null check (deposited_amount >= 0),
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  deposit_date date not null,
  deposit_slip_reference text not null,
  variance numeric(18,2) not null default 0,
  variance_status text not null default 'clear' check (variance_status in ('clear','review_required','reviewed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_cash_deposits_session on public.cash_deposits(cash_count_session_id);
create index if not exists idx_cash_deposits_variance on public.cash_deposits(variance_status, deposit_date desc);

create or replace function app_private.tg_cash_deposit_variance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_counted numeric(18,2);
begin
  select total_counted into v_counted
  from public.cash_count_sessions
  where id = new.cash_count_session_id;
  new.variance := new.deposited_amount - coalesce(v_counted, 0);
  new.variance_status := case when new.variance = 0 then 'clear' else 'review_required' end;
  return new;
end $$;
drop trigger if exists trg_cash_deposit_variance on public.cash_deposits;
create trigger trg_cash_deposit_variance
  before insert or update of deposited_amount, cash_count_session_id on public.cash_deposits
  for each row execute function app_private.tg_cash_deposit_variance();

create or replace function public.ingest_bank_feed_transaction(
  p_bank_account_id uuid,
  p_provider public.bank_feed_provider,
  p_external_transaction_id text,
  p_transaction_date date,
  p_amount numeric,
  p_currency text,
  p_description text default null,
  p_raw_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.bank_feed_transactions
    (bank_account_id, provider, external_transaction_id, transaction_date, amount, currency, description, raw_payload)
  values
    (p_bank_account_id, p_provider, p_external_transaction_id, p_transaction_date,
     p_amount, upper(p_currency)::char(3), p_description, coalesce(p_raw_payload, '{}'::jsonb))
  on conflict (provider, external_transaction_id) do update
    set bank_account_id = excluded.bank_account_id,
        transaction_date = excluded.transaction_date,
        amount = excluded.amount,
        currency = excluded.currency,
        description = excluded.description,
        raw_payload = excluded.raw_payload
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.ingest_bank_feed_transaction(uuid,public.bank_feed_provider,text,date,numeric,text,text,jsonb)
  from public, anon, authenticated;

create or replace function public.auto_match_bank_feed(p_bank_account_id uuid default null)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare
  r record;
  v_line uuid;
  v_count int := 0;
begin
  for r in
    select bft.*, ba.entity_id
    from public.bank_feed_transactions bft
    join public.bank_accounts ba on ba.id = bft.bank_account_id
    where bft.status = 'unmatched'
      and (p_bank_account_id is null or bft.bank_account_id = p_bank_account_id)
    order by bft.transaction_date, bft.imported_at
  loop
    select jel.id into v_line
    from public.journal_entry_lines jel
    join public.journal_entries je on je.id = jel.journal_entry_id
    left join public.reconciliation_matches rm on rm.matched_journal_entry_line_id = jel.id
    where rm.id is null
      and je.status = 'posted'
      and jel.entity_id = r.entity_id
      and jel.currency = r.currency
      and je.transaction_date between r.transaction_date - 2 and r.transaction_date + 2
      and (
        (r.amount > 0 and abs(jel.debit_amount - r.amount) < 0.01)
        or (r.amount < 0 and abs(jel.credit_amount - abs(r.amount)) < 0.01)
      )
    order by
      abs(je.transaction_date - r.transaction_date),
      case
        when r.description is null or je.description is null then 1
        when lower(je.description) = lower(r.description) then 0
        when extensions.similarity(lower(je.description), lower(r.description)) >= 0.25 then 0
        else 1
      end,
      je.created_at
    limit 1;

    if v_line is not null then
      insert into public.reconciliation_matches
        (bank_feed_transaction_id, matched_journal_entry_line_id, match_type)
      values (r.id, v_line, 'auto')
      on conflict do nothing;

      update public.bank_feed_transactions set status = 'matched' where id = r.id;

      update public.giving_records gr
         set reconciliation_status = 'matched'
      from public.journal_entry_lines jel
      where jel.id = v_line and gr.journal_entry_id = jel.journal_entry_id;

      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;
revoke all on function public.auto_match_bank_feed(uuid) from public, anon, authenticated;

create or replace function public.manual_match_bank_feed(
  p_bank_feed_transaction_id uuid,
  p_journal_entry_line_id uuid,
  p_actor uuid
) returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.reconciliation_matches
    (bank_feed_transaction_id, matched_journal_entry_line_id, match_type, matched_by)
  values
    (p_bank_feed_transaction_id, p_journal_entry_line_id, 'manual', p_actor);

  update public.bank_feed_transactions
     set status = 'matched'
   where id = p_bank_feed_transaction_id;

  update public.giving_records gr
     set reconciliation_status = 'matched'
  from public.journal_entry_lines jel
  where jel.id = p_journal_entry_line_id and gr.journal_entry_id = jel.journal_entry_id;
end $$;
revoke all on function public.manual_match_bank_feed(uuid,uuid,uuid) from public, anon, authenticated;

create or replace view public.bank_reconciliation_dashboard with (security_invoker = true) as
select ba.entity_id,
       e.name as entity_name,
       ba.id as bank_account_id,
       ba.bank_name,
       ba.account_number_last4,
       ba.currency,
       count(bft.id) filter (where bft.status = 'unmatched')::int as unmatched_bank_transactions,
       count(bft.id) filter (
         where bft.status = 'unmatched'
           and bft.imported_at < now() - (coalesce(rs.unmatched_bank_tx_hours,48) || ' hours')::interval
       )::int as manual_review_queue,
       coalesce(sum(abs(bft.amount)) filter (where bft.status = 'unmatched'), 0) as unmatched_bank_amount
from public.bank_accounts ba
join public.entities e on e.id = ba.entity_id
left join public.reconciliation_settings rs on rs.entity_id = ba.entity_id
left join public.bank_feed_transactions bft on bft.bank_account_id = ba.id
group by ba.id, e.name, rs.unmatched_bank_tx_hours;

create or replace view public.unreconciled_operational_items with (security_invoker = true) as
select 'giving'::text as item_type,
       gr.id as item_id,
       gr.recording_entity_id as entity_id,
       e.name as entity_name,
       gr.transaction_date as item_date,
       gt.name as description,
       gr.amount,
       gr.currency,
       gr.reconciliation_status::text as status,
       (current_date - gr.transaction_date)::int as age_days,
       ((current_date - gr.transaction_date)::int >= coalesce(rs.stale_unreconciled_days, 7)) as is_stale
from public.giving_records gr
join public.entities e on e.id = gr.recording_entity_id
join public.giving_types gt on gt.id = gr.giving_type_id
left join public.reconciliation_settings rs on rs.entity_id = gr.recording_entity_id
where gr.reconciliation_status = 'unreconciled'
union all
select 'expense_payment'::text,
       dr.id,
       coalesce(rr.entity_id, rb.entity_id) as entity_id,
       e.name,
       coalesce(dr.disbursed_at::date, dr.created_at::date),
       coalesce(rr.description, 'Compiled requisition batch') as description,
       dr.net_payable_amount,
       coalesce(rr.currency, rb.currency),
       dr.disbursement_status::text,
       (current_date - coalesce(dr.disbursed_at::date, dr.created_at::date))::int,
       ((current_date - coalesce(dr.disbursed_at::date, dr.created_at::date))::int >= coalesce(rs.stale_unreconciled_days, 7))
from public.disbursement_records dr
left join public.requisition_requests rr on rr.id = dr.requisition_request_id
left join public.requisition_batches rb on rb.id = dr.requisition_batch_id
join public.entities e on e.id = coalesce(rr.entity_id, rb.entity_id)
left join public.journal_entry_lines jel on jel.journal_entry_id = dr.journal_entry_id and jel.credit_amount > 0
left join public.reconciliation_matches rm on rm.matched_journal_entry_line_id = jel.id
left join public.reconciliation_settings rs on rs.entity_id = e.id
where dr.disbursement_status = 'disbursed'
  and dr.journal_entry_id is not null
  and rm.id is null;

create or replace view public.cash_variance_report with (security_invoker = true) as
select ccs.id as cash_count_session_id,
       ccs.entity_id,
       e.name as entity_name,
       ccs.service_date,
       ccs.counted_by,
       ccs.total_counted,
       ccs.currency,
       ccs.sealed_bag_reference,
       cd.id as cash_deposit_id,
       cd.deposited_amount,
       cd.deposit_date,
       cd.deposit_slip_reference,
       cd.variance,
       cd.variance_status,
       ba.bank_name,
       ba.account_number_last4
from public.cash_count_sessions ccs
join public.entities e on e.id = ccs.entity_id
left join public.cash_deposits cd on cd.cash_count_session_id = ccs.id
left join public.bank_accounts ba on ba.id = cd.bank_account_id;

do $$
declare t text;
begin
  foreach t in array array[
    'bank_feed_connections','bank_feed_transactions','reconciliation_matches',
    'reconciliation_settings','cash_count_sessions','cash_deposits'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function app_private.tg_audit()', t);
  end loop;
end $$;

grant select on public.bank_reconciliation_dashboard,
                public.unreconciled_operational_items,
                public.cash_variance_report
  to authenticated;
grant execute on function public.distinct_uuid_count(uuid[]) to authenticated, service_role;

drop policy if exists bank_feed_connections_select on public.bank_feed_connections;
create policy bank_feed_connections_select on public.bank_feed_connections for select to authenticated
  using (exists (
    select 1 from public.bank_accounts ba
    where ba.id = bank_account_id and public.user_can_access_entity(ba.entity_id)
  ));

drop policy if exists bank_feed_transactions_select on public.bank_feed_transactions;
create policy bank_feed_transactions_select on public.bank_feed_transactions for select to authenticated
  using (exists (
    select 1 from public.bank_accounts ba
    where ba.id = bank_account_id and public.user_can_access_entity(ba.entity_id)
  ));

drop policy if exists reconciliation_matches_select on public.reconciliation_matches;
create policy reconciliation_matches_select on public.reconciliation_matches for select to authenticated
  using (exists (
    select 1 from public.bank_feed_transactions bft
    join public.bank_accounts ba on ba.id = bft.bank_account_id
    where bft.id = bank_feed_transaction_id and public.user_can_access_entity(ba.entity_id)
  ));

drop policy if exists reconciliation_settings_select on public.reconciliation_settings;
create policy reconciliation_settings_select on public.reconciliation_settings for select to authenticated
  using (public.user_can_access_entity(entity_id));

drop policy if exists cash_count_sessions_select on public.cash_count_sessions;
create policy cash_count_sessions_select on public.cash_count_sessions for select to authenticated
  using (public.user_can_access_entity(entity_id));

drop policy if exists cash_deposits_select on public.cash_deposits;
create policy cash_deposits_select on public.cash_deposits for select to authenticated
  using (exists (
    select 1 from public.cash_count_sessions ccs
    where ccs.id = cash_count_session_id and public.user_can_access_entity(ccs.entity_id)
  ));
