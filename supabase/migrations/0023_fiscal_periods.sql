-- ===========================================================================
-- Harvesters Finance OS — 0023 Accounting periods, JE numbering, year-end close
--
-- The three controls that separate "the ledger balances" from "the books can
-- be closed":
--   1. FISCAL PERIODS — monthly periods (calendar fiscal year). Posting is
--      only allowed into an OPEN period, and never into the future. Periods
--      auto-create as open on first use; closing them is an explicit,
--      audited super-admin/CFO action.
--   2. SEQUENTIAL ENTRY NUMBERS — every posted journal entry receives a
--      gapless number per entity per fiscal year (JE-2026-000123), assigned
--      atomically at posting. A numbering gap is evidence of tampering.
--   3. YEAR-END CLOSE — a sanctioned function that sweeps income/expense to
--      Retained Earnings (3900) per entity/fund via 'closing' entries, once
--      every period of the year is closed. Reports exclude closing entries
--      from income-statement views (migration 0027).
-- ===========================================================================

-- --- Period status ----------------------------------------------------------
do $$ begin create type public.fiscal_period_status as enum ('open','closed');
exception when duplicate_object then null; end $$;

-- --- Fiscal periods (global monthly calendar; one close cadence for the org)
create table if not exists public.fiscal_periods (
  id           uuid primary key default gen_random_uuid(),
  period_start date not null unique,          -- first day of month
  period_end   date not null,                 -- last day of month
  fiscal_year  int  not null,
  label        text not null,                 -- e.g. '2026-07'
  status       public.fiscal_period_status not null default 'open',
  closed_by    uuid references auth.users(id),
  closed_at    timestamptz,
  reopened_by  uuid references auth.users(id),
  reopened_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint fp_month_aligned check (period_start = date_trunc('month', period_start)::date),
  constraint fp_end_matches check (period_end = (period_start + interval '1 month' - interval '1 day')::date)
);
create index if not exists idx_fiscal_periods_year on public.fiscal_periods(fiscal_year);

comment on table public.fiscal_periods is
  'Monthly accounting periods (calendar fiscal year). Posting requires an open period; closing is an audited admin action.';

-- --- Year-close registry -----------------------------------------------------
create table if not exists public.fiscal_year_closes (
  fiscal_year  int primary key,
  closed_by    uuid references auth.users(id),
  closed_at    timestamptz not null default now(),
  entries_created int not null default 0,
  net_income_ngn  numeric(20,2)
);

-- --- Gapless JE counters (internal) ------------------------------------------
create table if not exists app_private.je_counters (
  entity_id   uuid not null references public.entities(id) on delete cascade,
  fiscal_year int  not null,
  last_value  bigint not null default 0,
  primary key (entity_id, fiscal_year)
);

-- --- Entry number column ------------------------------------------------------
alter table public.journal_entries add column if not exists entry_number text;
create unique index if not exists uq_je_entity_number
  on public.journal_entries(entity_id, entry_number) where entry_number is not null;

comment on column public.journal_entries.entry_number is
  'Gapless sequential number per entity per fiscal year (JE-YYYY-NNNNNN), assigned atomically at posting. Never reused; a gap is evidence of tampering.';

-- ---------------------------------------------------------------------------
-- Period helpers
-- ---------------------------------------------------------------------------
create or replace function app_private.ensure_fiscal_period(p_date date)
returns public.fiscal_periods language plpgsql volatile set search_path = '' as $$
declare
  v_start date := date_trunc('month', p_date)::date;
  v_row public.fiscal_periods;
begin
  select * into v_row from public.fiscal_periods where period_start = v_start;
  if found then return v_row; end if;
  insert into public.fiscal_periods (period_start, period_end, fiscal_year, label)
  values (v_start, (v_start + interval '1 month' - interval '1 day')::date,
          extract(year from v_start)::int, to_char(v_start, 'YYYY-MM'))
  on conflict (period_start) do nothing;
  select * into v_row from public.fiscal_periods where period_start = v_start;
  return v_row;
end $$;

-- Raise unless the period covering p_date is open. Auto-creates missing months.
create or replace function app_private.assert_period_open(p_date date)
returns void language plpgsql volatile set search_path = '' as $$
declare v public.fiscal_periods;
begin
  v := app_private.ensure_fiscal_period(p_date);
  if v.status <> 'open' then
    raise exception 'Accounting period % is closed — postings into it are not allowed (reopen it under Admin → Periods if a correction is genuinely required)', v.label
      using errcode = 'check_violation';
  end if;
end $$;

-- Gapless next number, serialized per (entity, year) by the counter row lock.
create or replace function app_private.next_je_number(p_entity uuid, p_year int)
returns text language plpgsql volatile set search_path = '' as $$
declare v bigint;
begin
  insert into app_private.je_counters (entity_id, fiscal_year, last_value)
  values (p_entity, p_year, 1)
  on conflict (entity_id, fiscal_year)
  do update set last_value = app_private.je_counters.last_value + 1
  returning last_value into v;
  return 'JE-' || p_year::text || '-' || lpad(v::text, 6, '0');
end $$;

-- ---------------------------------------------------------------------------
-- Journal entry guard v2 — adds period + future-date enforcement and entry
-- numbering to the immutability rules of 0002. Semantics preserved:
--   draft -> editable; posted -> immutable except posted->reversed; etc.
-- New at draft -> posted:
--   • transaction_date must not be in the future
--   • the covering fiscal period must be open ('closing' entries exempt:
--     the year-close runs after all periods close, by design)
--   • entry_number is assigned (gapless, per entity per fiscal year)
-- ---------------------------------------------------------------------------
create or replace function app_private.tg_journal_entries_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'posted' then
      raise exception 'Insert journal entries as draft, then post (entry cannot be created posted)'
        using errcode = 'check_violation';
    end if;
    if new.entry_number is not null then
      raise exception 'entry_number is system-assigned at posting' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Posted/reversed journal entry % is immutable and cannot be deleted', old.id
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.status = 'draft' then
    if new.status = 'posted' then
      if new.transaction_date > current_date then
        raise exception 'Journal entry % is dated in the future (%) and cannot be posted', new.id, new.transaction_date
          using errcode = 'check_violation';
      end if;
      if new.source_module <> 'closing' then
        perform app_private.assert_period_open(new.transaction_date);
      end if;
      perform app_private.assert_entry_balanced(new.id);
      new.entry_number := app_private.next_je_number(
        new.entity_id, extract(year from new.transaction_date)::int);
      new.posted_at := coalesce(new.posted_at, now());
    elsif new.status = 'reversed' then
      raise exception 'A draft cannot move directly to reversed' using errcode = 'check_violation';
    elsif new.entry_number is not null then
      raise exception 'entry_number is system-assigned at posting' using errcode = 'check_violation';
    end if;
    return new;

  elsif old.status = 'posted' then
    -- The only permitted mutation of a posted entry is marking it reversed.
    if new.status = 'reversed'
       and new.entity_id            =            old.entity_id
       and new.transaction_date     =            old.transaction_date
       and new.description          is not distinct from old.description
       and new.source_module        =            old.source_module
       and new.created_by           is not distinct from old.created_by
       and new.reversal_of_entry_id is not distinct from old.reversal_of_entry_id
       and new.posted_at            is not distinct from old.posted_at
       and new.entry_number         is not distinct from old.entry_number then
      return new;
    end if;
    raise exception 'Posted journal entry % is immutable (only posted -> reversed is allowed)', old.id
      using errcode = 'check_violation';

  else -- reversed
    raise exception 'Reversed journal entry % is immutable', old.id
      using errcode = 'check_violation';
  end if;
end $$;
-- (trigger trg_journal_entries_guard already bound to this function by 0002)

-- ---------------------------------------------------------------------------
-- Period administration (SECURITY DEFINER; server-only)
-- ---------------------------------------------------------------------------
create or replace function public.close_fiscal_period(p_period_start date, p_actor uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v public.fiscal_periods;
begin
  v := app_private.ensure_fiscal_period(p_period_start);
  if v.period_end >= current_date then
    raise exception 'Period % cannot be closed before it has ended', v.label using errcode = 'check_violation';
  end if;
  if v.status = 'closed' then return; end if;
  update public.fiscal_periods
     set status = 'closed', closed_by = p_actor, closed_at = now()
   where id = v.id;
end $$;

create or replace function public.reopen_fiscal_period(p_period_start date, p_actor uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v public.fiscal_periods;
begin
  select * into v from public.fiscal_periods
  where period_start = date_trunc('month', p_period_start)::date;
  if not found then
    raise exception 'No such period' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.fiscal_year_closes where fiscal_year = v.fiscal_year) then
    raise exception 'Fiscal year % is closed — its periods cannot be reopened', v.fiscal_year
      using errcode = 'check_violation';
  end if;
  update public.fiscal_periods
     set status = 'open', reopened_by = p_actor, reopened_at = now()
   where id = v.id;
end $$;

-- Convenience for onboarding/back-closing: close every ended period up to a date.
create or replace function public.close_fiscal_periods_through(p_through date, p_actor uuid)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare v_start date; v_n int := 0;
begin
  -- Materialize a period row for every month that has posted activity.
  for v_start in
    select distinct date_trunc('month', je.transaction_date)::date
    from public.journal_entries je where je.status in ('posted','reversed')
  loop
    perform app_private.ensure_fiscal_period(v_start);
  end loop;

  update public.fiscal_periods
     set status = 'closed', closed_by = p_actor, closed_at = now()
   where status = 'open'
     and period_end < least(p_through, current_date);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.close_fiscal_period(date, uuid) from public, anon, authenticated;
revoke all on function public.reopen_fiscal_period(date, uuid) from public, anon, authenticated;
revoke all on function public.close_fiscal_periods_through(date, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retained earnings account
-- ---------------------------------------------------------------------------
insert into public.accounts (code, name, account_type, fund_classification)
select '3900', 'Accumulated Fund (Retained Earnings)', 'equity', 'unrestricted'
where not exists (select 1 from public.accounts where code = '3900');

-- ---------------------------------------------------------------------------
-- Year-end close — sweep income/expense to Retained Earnings per entity/fund.
-- Requires every period of the year to be closed. Emits one 'closing' entry
-- per entity, dated 31 Dec, whose lines zero each P&L account in BOTH its
-- native currency and presentation currency (line fx = effective historical
-- average); any pure-FX residue lands as an NGN adjustment line.
-- ---------------------------------------------------------------------------
create or replace function public.close_fiscal_year(p_year int, p_actor uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_close_date date := make_date(p_year, 12, 31);
  v_entity record;
  v_line record;
  v_entry uuid;
  v_re uuid;
  v_entries int := 0;
  v_total_net numeric(20,2) := 0;
  v_entity_net numeric(20,2);
  v_open int;
begin
  if exists (select 1 from public.fiscal_year_closes where fiscal_year = p_year) then
    raise exception 'Fiscal year % is already closed', p_year using errcode = 'check_violation';
  end if;
  if v_close_date >= current_date then
    raise exception 'Fiscal year % has not ended yet', p_year using errcode = 'check_violation';
  end if;

  -- Materialize periods for all active months, then demand they are closed.
  perform app_private.ensure_fiscal_period(make_date(p_year, m, 1)) from generate_series(1,12) m;
  select count(*) into v_open from public.fiscal_periods
  where fiscal_year = p_year and status = 'open';
  if v_open > 0 then
    raise exception 'Close all % remaining open period(s) of % before running the year-end close', v_open, p_year
      using errcode = 'check_violation';
  end if;

  select id into v_re from public.accounts where code = '3900';
  if v_re is null then
    raise exception 'Retained earnings account 3900 is missing' using errcode = 'check_violation';
  end if;

  for v_entity in
    select distinct jel.entity_id
    from public.journal_entry_lines jel
    join public.journal_entries je on je.id = jel.journal_entry_id
    join public.accounts a on a.id = jel.account_id
    where je.status = 'posted' and je.source_module <> 'closing'
      and a.account_type in ('income','expense')
      and je.transaction_date between make_date(p_year,1,1) and v_close_date
  loop
    -- created_by stays NULL: this is a system posting (the audit log still
    -- records p_actor via the actor context), and the SoD creator<>approver
    -- backstop must not fire on the mechanical close.
    insert into public.journal_entries
      (entity_id, transaction_date, description, source_module, created_by, status)
    values
      (v_entity.entity_id, v_close_date,
       'Year-end close FY' || p_year::text || ' — income & expense to retained earnings',
       'closing', null, 'draft')
    returning id into v_entry;

    v_entity_net := 0;

    for v_line in
      select jel.account_id, a.account_type, jel.fund_classification, jel.currency,
             sum(jel.credit_amount - jel.debit_amount) as local_net,
             sum(round((jel.credit_amount - jel.debit_amount) * jel.fx_rate_to_presentation_currency, 2)) as pres_net
      from public.journal_entry_lines jel
      join public.journal_entries je on je.id = jel.journal_entry_id
      join public.accounts a on a.id = jel.account_id
      where je.status = 'posted' and je.source_module <> 'closing'
        and jel.entity_id = v_entity.entity_id
        and a.account_type in ('income','expense')
        and je.transaction_date between make_date(p_year,1,1) and v_close_date
      group by jel.account_id, a.account_type, jel.fund_classification, jel.currency
      having sum(jel.credit_amount - jel.debit_amount) <> 0
          or sum(round((jel.credit_amount - jel.debit_amount) * jel.fx_rate_to_presentation_currency, 2)) <> 0
    loop
      declare
        v_rate numeric(20,10);
        v_residue numeric(20,2);
      begin
        if v_line.local_net <> 0 then
          -- Flip the account's local balance at its effective historical
          -- average rate (falls back to 1 if the ratio is unusable).
          v_rate := case when v_line.pres_net / v_line.local_net > 0
                         then round(v_line.pres_net / v_line.local_net, 10)
                         else 1 end;
          insert into public.journal_entry_lines
            (journal_entry_id, account_id, entity_id, debit_amount, credit_amount,
             fund_classification, currency, fx_rate_to_presentation_currency)
          values
            (v_entry, v_line.account_id, v_entity.entity_id,
             case when v_line.local_net > 0 then v_line.local_net else 0 end,
             case when v_line.local_net < 0 then -v_line.local_net else 0 end,
             v_line.fund_classification, v_line.currency, v_rate);
          -- Rounding / sign residue in presentation currency, if any.
          v_residue := v_line.pres_net - round(v_line.local_net * v_rate, 2);
        else
          -- Local currency already nets to zero but presentation does not
          -- (mixed historical rates): the whole amount is residue.
          v_residue := v_line.pres_net;
        end if;

        if v_residue <> 0 then
          insert into public.journal_entry_lines
            (journal_entry_id, account_id, entity_id, debit_amount, credit_amount,
             fund_classification, currency, fx_rate_to_presentation_currency)
          values
            (v_entry, v_line.account_id, v_entity.entity_id,
             case when v_residue > 0 then v_residue else 0 end,
             case when v_residue < 0 then -v_residue else 0 end,
             v_line.fund_classification, 'NGN', 1);
        end if;
        v_entity_net := v_entity_net + v_line.pres_net;
      end;
    end loop;

    -- Retained earnings plug per entity (presentation currency).
    if v_entity_net <> 0 then
      insert into public.journal_entry_lines
        (journal_entry_id, account_id, entity_id, debit_amount, credit_amount,
         fund_classification, currency, fx_rate_to_presentation_currency)
      values
        (v_entry, v_re, v_entity.entity_id,
         case when v_entity_net < 0 then -v_entity_net else 0 end,
         case when v_entity_net > 0 then v_entity_net else 0 end,
         'unrestricted', 'NGN', 1);
    end if;

    -- An entity whose P&L nets exactly to zero still gets no dangling draft.
    if (select count(*) from public.journal_entry_lines where journal_entry_id = v_entry) < 2 then
      delete from public.journal_entry_lines where journal_entry_id = v_entry;
      delete from public.journal_entries where id = v_entry;
      continue;
    end if;

    update public.journal_entries
       set status = 'posted', approved_by = p_actor
     where id = v_entry;

    v_entries := v_entries + 1;
    v_total_net := v_total_net + v_entity_net;
  end loop;

  insert into public.fiscal_year_closes (fiscal_year, closed_by, entries_created, net_income_ngn)
  values (p_year, p_actor, v_entries, v_total_net);

  return jsonb_build_object('fiscal_year', p_year, 'closing_entries', v_entries,
                            'net_income_ngn', v_total_net);
end $$;
revoke all on function public.close_fiscal_year(int, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: number all existing posted/reversed entries in posting order and
-- prime the counters. Guards are disabled only for this one-time, in-migration
-- backfill; audit stays quiet (a migration is not a user action).
-- ---------------------------------------------------------------------------
alter table public.journal_entries disable trigger trg_journal_entries_guard;
alter table public.journal_entries disable trigger trg_audit;

with numbered as (
  select id, entity_id, extract(year from transaction_date)::int as y,
         row_number() over (
           partition by entity_id, extract(year from transaction_date)
           order by posted_at nulls last, created_at, id) as rn
  from public.journal_entries
  where status in ('posted','reversed') and entry_number is null
)
update public.journal_entries je
   set entry_number = 'JE-' || n.y::text || '-' || lpad(n.rn::text, 6, '0')
  from numbered n where n.id = je.id;

insert into app_private.je_counters (entity_id, fiscal_year, last_value)
select entity_id, extract(year from transaction_date)::int,
       count(*)
from public.journal_entries
where status in ('posted','reversed')
group by entity_id, extract(year from transaction_date)::int
on conflict (entity_id, fiscal_year)
do update set last_value = greatest(app_private.je_counters.last_value, excluded.last_value);

alter table public.journal_entries enable trigger trg_audit;
alter table public.journal_entries enable trigger trg_journal_entries_guard;

-- Materialize open periods for every month that already has activity.
select app_private.ensure_fiscal_period(d)
from (select distinct date_trunc('month', transaction_date)::date as d
      from public.journal_entries) m(d);

-- ---------------------------------------------------------------------------
-- RLS + audit on the new tables
-- ---------------------------------------------------------------------------
alter table public.fiscal_periods enable row level security;
alter table public.fiscal_year_closes enable row level security;
revoke all on public.fiscal_periods, public.fiscal_year_closes from anon, authenticated;
grant select on public.fiscal_periods, public.fiscal_year_closes to authenticated;
grant all on public.fiscal_periods, public.fiscal_year_closes to service_role;

drop policy if exists fiscal_periods_select on public.fiscal_periods;
create policy fiscal_periods_select on public.fiscal_periods
  for select to authenticated using (true);
drop policy if exists fiscal_year_closes_select on public.fiscal_year_closes;
create policy fiscal_year_closes_select on public.fiscal_year_closes
  for select to authenticated using (true);

drop trigger if exists trg_audit on public.fiscal_periods;
create trigger trg_audit after insert or update or delete on public.fiscal_periods
  for each row execute function app_private.tg_audit();
drop trigger if exists trg_audit on public.fiscal_year_closes;
create trigger trg_audit after insert or update or delete on public.fiscal_year_closes
  for each row execute function app_private.tg_audit();
