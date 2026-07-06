-- ===========================================================================
-- Harvesters Finance OS — 0030 Fixed asset register & depreciation
--
-- Churches are property-heavy (buildings, buses, generators, AV rigs) and an
-- incorporated trustee must account for them. This adds:
--   • A fixed-asset register per entity, capitalized THROUGH the ledger
--     (debit Fixed Assets, credit Bank — or Opening Balance Equity for
--     assets owned before go-live).
--   • Straight-line monthly depreciation, posted as balanced journal
--     entries (debit Depreciation Expense, credit Accumulated Depreciation),
--     idempotent per asset per month, run automatically by the nightly job.
--   • Disposal with automatic gain/loss computation posted to the ledger.
-- Balances (accumulated depreciation, net book value) are DERIVED — the
-- register never stores an editable balance.
-- ===========================================================================

-- --- Accounts ----------------------------------------------------------------
insert into public.accounts (code, name, account_type, fund_classification)
select v.code, v.name, v.t::public.account_type, 'unrestricted'
from (values
  ('1500','Fixed Assets','asset'),
  ('1510','Accumulated Depreciation','asset'),          -- contra-asset
  ('4090','Gain on Asset Disposal','income'),
  ('6100','Depreciation Expense','expense'),
  ('6110','Loss on Asset Disposal','expense')
) as v(code, name, t)
where not exists (select 1 from public.accounts a where a.code = v.code);

-- --- Register ------------------------------------------------------------------
do $$ begin create type public.fixed_asset_status as enum
  ('active','fully_depreciated','disposed');
exception when duplicate_object then null; end $$;

create table if not exists public.fixed_assets (
  id                 uuid primary key default gen_random_uuid(),
  entity_id          uuid not null references public.entities(id) on delete restrict,
  name               text not null,
  category           text not null check (category in
    ('building','land','vehicle','generator','equipment','av_production','furniture','other')),
  acquisition_date   date not null,
  cost               numeric(18,2) not null check (cost > 0),
  salvage_value      numeric(18,2) not null default 0 check (salvage_value >= 0),
  useful_life_months int not null check (useful_life_months > 0),
  currency           char(3) not null,
  depreciation_start date not null,
  status             public.fixed_asset_status not null default 'active',
  capitalization_journal_entry_id uuid references public.journal_entries(id),
  disposed_at        date,
  disposal_proceeds  numeric(18,2),
  disposal_journal_entry_id uuid references public.journal_entries(id),
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  constraint fa_salvage_lte_cost check (salvage_value <= cost)
);
create index if not exists idx_fixed_assets_entity on public.fixed_assets(entity_id);
create index if not exists idx_fixed_assets_status on public.fixed_assets(status);

-- One depreciation posting per asset per month — the idempotency backbone.
create table if not exists public.fixed_asset_depreciation (
  id               uuid primary key default gen_random_uuid(),
  fixed_asset_id   uuid not null references public.fixed_assets(id) on delete restrict,
  period_start     date not null,
  amount           numeric(18,2) not null check (amount > 0),
  journal_entry_id uuid not null references public.journal_entries(id),
  created_at       timestamptz not null default now(),
  unique (fixed_asset_id, period_start)
);

-- --- Capitalize ------------------------------------------------------------------
-- p_funding: 'bank' (paid from operations bank) | 'opening' (owned pre-go-live,
-- plugged to Opening Balance Equity like the opening-balance import).
create or replace function public.capitalize_fixed_asset(
  p_entity_id uuid, p_name text, p_category text, p_acquisition_date date,
  p_cost numeric, p_salvage numeric, p_life_months int,
  p_funding text default 'bank', p_actor uuid default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_currency char(3);
  v_fa uuid; v_credit uuid; v_asset_acct uuid; v_je uuid;
begin
  select functional_currency into v_currency from public.entities where id = p_entity_id;
  if v_currency is null then raise exception 'Entity not found' using errcode = 'check_violation'; end if;
  if p_acquisition_date > current_date then
    raise exception 'Acquisition date cannot be in the future' using errcode = 'check_violation';
  end if;

  select id into v_asset_acct from public.accounts where code = '1500';
  select id into v_credit from public.accounts
    where code = case when p_funding = 'opening' then '3200' else '1010' end;

  insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
  values (p_entity_id, p_acquisition_date,
          'Capitalize fixed asset: ' || p_name, 'adjustment', p_actor, 'draft')
  returning id into v_je;
  insert into public.journal_entry_lines
    (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
  values
    (v_je, v_asset_acct, p_entity_id, p_cost, 0, 'unrestricted', v_currency),
    (v_je, v_credit, p_entity_id, 0, p_cost, 'unrestricted', v_currency);
  update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_je;

  insert into public.fixed_assets
    (entity_id, name, category, acquisition_date, cost, salvage_value, useful_life_months,
     currency, depreciation_start, capitalization_journal_entry_id, created_by)
  values
    (p_entity_id, p_name, p_category, p_acquisition_date, p_cost, coalesce(p_salvage, 0),
     p_life_months, v_currency, date_trunc('month', p_acquisition_date)::date, v_je, p_actor)
  returning id into v_fa;
  return v_fa;
end $$;

-- --- Monthly depreciation run -------------------------------------------------
-- Posts straight-line depreciation for p_period (a month) for every active
-- asset that has not yet been depreciated for that month. One aggregate entry
-- per entity, dated the last day of the month. Idempotent (unique constraint).
create or replace function public.run_monthly_depreciation(
  p_period date default (date_trunc('month', current_date) - interval '1 month')::date,
  p_actor uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_entry_date date := (date_trunc('month', p_period) + interval '1 month' - interval '1 day')::date;
  v_exp uuid; v_accum uuid;
  v_entity record; v_asset record;
  v_je uuid; v_monthly numeric(18,2); v_remaining numeric(18,2); v_amt numeric(18,2);
  v_total numeric(18,2) := 0; v_assets int := 0; v_entries int := 0;
begin
  if v_entry_date >= current_date then
    raise exception 'Cannot depreciate a month that has not ended' using errcode = 'check_violation';
  end if;
  select id into v_exp from public.accounts where code = '6100';
  select id into v_accum from public.accounts where code = '1510';

  for v_entity in
    select distinct fa.entity_id, e.functional_currency
    from public.fixed_assets fa join public.entities e on e.id = fa.entity_id
    where fa.status = 'active' and fa.depreciation_start <= v_period
  loop
    v_je := null;
    for v_asset in
      select fa.* from public.fixed_assets fa
      where fa.entity_id = v_entity.entity_id and fa.status = 'active'
        and fa.depreciation_start <= v_period
        and not exists (select 1 from public.fixed_asset_depreciation d
                        where d.fixed_asset_id = fa.id and d.period_start = v_period)
    loop
      v_monthly := round((v_asset.cost - v_asset.salvage_value) / v_asset.useful_life_months, 2);
      select (v_asset.cost - v_asset.salvage_value) - coalesce(sum(amount), 0)
        into v_remaining
      from public.fixed_asset_depreciation where fixed_asset_id = v_asset.id;
      v_amt := least(v_monthly, v_remaining);
      if v_amt <= 0 then
        update public.fixed_assets set status = 'fully_depreciated' where id = v_asset.id;
        continue;
      end if;

      if v_je is null then
        insert into public.journal_entries
          (entity_id, transaction_date, description, source_module, created_by, status)
        values (v_entity.entity_id, v_entry_date,
                'Monthly depreciation ' || to_char(v_period, 'YYYY-MM'), 'adjustment', null, 'draft')
        returning id into v_je;
        v_entries := v_entries + 1;
      end if;

      insert into public.journal_entry_lines
        (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
      values
        (v_je, v_exp, v_entity.entity_id, v_amt, 0, 'unrestricted', v_entity.functional_currency),
        (v_je, v_accum, v_entity.entity_id, 0, v_amt, 'unrestricted', v_entity.functional_currency);

      insert into public.fixed_asset_depreciation (fixed_asset_id, period_start, amount, journal_entry_id)
      values (v_asset.id, v_period, v_amt, v_je);

      if v_amt >= v_remaining then
        update public.fixed_assets set status = 'fully_depreciated' where id = v_asset.id;
      end if;
      v_total := v_total + v_amt; v_assets := v_assets + 1;
    end loop;

    if v_je is not null then
      update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_je;
    end if;
  end loop;

  return jsonb_build_object('period', to_char(v_period, 'YYYY-MM'),
    'assets_depreciated', v_assets, 'entries_posted', v_entries, 'total_amount', v_total);
end $$;

-- --- Disposal -------------------------------------------------------------------
create or replace function public.dispose_fixed_asset(
  p_asset_id uuid, p_disposal_date date, p_proceeds numeric, p_actor uuid default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  a public.fixed_assets; v_accum numeric(18,2); v_nbv numeric(18,2); v_gain numeric(18,2);
  v_je uuid; v_asset_acct uuid; v_accum_acct uuid; v_bank uuid; v_gain_acct uuid; v_loss_acct uuid;
begin
  select * into a from public.fixed_assets where id = p_asset_id for update;
  if not found then raise exception 'Asset not found' using errcode = 'check_violation'; end if;
  if a.status = 'disposed' then raise exception 'Asset already disposed' using errcode = 'check_violation'; end if;
  if p_disposal_date > current_date then
    raise exception 'Disposal date cannot be in the future' using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount), 0) into v_accum
  from public.fixed_asset_depreciation where fixed_asset_id = p_asset_id;
  v_nbv := a.cost - v_accum;
  v_gain := coalesce(p_proceeds, 0) - v_nbv;

  select id into v_asset_acct from public.accounts where code = '1500';
  select id into v_accum_acct from public.accounts where code = '1510';
  select id into v_bank from public.accounts where code = '1010';
  select id into v_gain_acct from public.accounts where code = '4090';
  select id into v_loss_acct from public.accounts where code = '6110';

  insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
  values (a.entity_id, p_disposal_date, 'Dispose fixed asset: ' || a.name, 'adjustment', p_actor, 'draft')
  returning id into v_je;

  -- Remove the asset (credit cost) and its accumulated depreciation (debit).
  insert into public.journal_entry_lines
    (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
  values (v_je, v_asset_acct, a.entity_id, 0, a.cost, 'unrestricted', a.currency);
  if v_accum > 0 then
    insert into public.journal_entry_lines
      (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
    values (v_je, v_accum_acct, a.entity_id, v_accum, 0, 'unrestricted', a.currency);
  end if;
  if coalesce(p_proceeds, 0) > 0 then
    insert into public.journal_entry_lines
      (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
    values (v_je, v_bank, a.entity_id, p_proceeds, 0, 'unrestricted', a.currency);
  end if;
  if v_gain > 0 then
    insert into public.journal_entry_lines
      (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
    values (v_je, v_gain_acct, a.entity_id, 0, v_gain, 'unrestricted', a.currency);
  elsif v_gain < 0 then
    insert into public.journal_entry_lines
      (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
    values (v_je, v_loss_acct, a.entity_id, -v_gain, 0, 'unrestricted', a.currency);
  end if;

  update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_je;
  update public.fixed_assets
     set status = 'disposed', disposed_at = p_disposal_date,
         disposal_proceeds = coalesce(p_proceeds, 0), disposal_journal_entry_id = v_je
   where id = p_asset_id;
  return v_je;
end $$;

revoke all on function public.capitalize_fixed_asset(uuid,text,text,date,numeric,numeric,int,text,uuid) from public, anon, authenticated;
revoke all on function public.run_monthly_depreciation(date,uuid) from public, anon, authenticated;
revoke all on function public.dispose_fixed_asset(uuid,date,numeric,uuid) from public, anon, authenticated;

-- --- Register view (derived balances) -------------------------------------------
create or replace view public.fixed_asset_register with (security_invoker = true) as
select fa.id, fa.entity_id, e.name as entity_name, fa.name, fa.category,
       fa.acquisition_date, fa.cost, fa.salvage_value, fa.useful_life_months,
       fa.currency, fa.status,
       coalesce(d.accumulated, 0)::numeric(18,2) as accumulated_depreciation,
       (fa.cost - coalesce(d.accumulated, 0))::numeric(18,2) as net_book_value,
       d.last_period as last_depreciated_period
from public.fixed_assets fa
join public.entities e on e.id = fa.entity_id
left join lateral (
  select sum(amount) as accumulated, max(period_start) as last_period
  from public.fixed_asset_depreciation where fixed_asset_id = fa.id
) d on true;

-- --- Nightly job hook: depreciation is idempotent, safe to attempt nightly ------
create or replace function public.run_nightly_jobs()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_esc int; v_mat int; v_dep jsonb;
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
  return jsonb_build_object(
    'escalated_approvals', v_esc,
    'maturity_notifications', v_mat,
    'depreciation', v_dep,
    'ran_at', now());
end $$;
revoke all on function public.run_nightly_jobs() from public, anon, authenticated;

-- --- RLS, grants, audit -----------------------------------------------------------
alter table public.fixed_assets enable row level security;
alter table public.fixed_asset_depreciation enable row level security;
revoke all on public.fixed_assets, public.fixed_asset_depreciation from anon, authenticated;
grant select on public.fixed_assets, public.fixed_asset_depreciation to authenticated;
grant all on public.fixed_assets, public.fixed_asset_depreciation to service_role;

drop policy if exists fixed_assets_select on public.fixed_assets;
create policy fixed_assets_select on public.fixed_assets for select to authenticated
  using (public.user_can_access_entity(entity_id));
drop policy if exists fad_select on public.fixed_asset_depreciation;
create policy fad_select on public.fixed_asset_depreciation for select to authenticated
  using (exists (select 1 from public.fixed_assets fa
                 where fa.id = fixed_asset_id and public.user_can_access_entity(fa.entity_id)));

drop policy if exists hfos_app_rw on public.fixed_assets;
create policy hfos_app_rw on public.fixed_assets for all to hfos_app using (true) with check (true);
drop policy if exists hfos_app_rw on public.fixed_asset_depreciation;
create policy hfos_app_rw on public.fixed_asset_depreciation for all to hfos_app using (true) with check (true);
grant select on public.fixed_asset_register to hfos_app;

drop trigger if exists trg_audit on public.fixed_assets;
create trigger trg_audit after insert or update or delete on public.fixed_assets
  for each row execute function app_private.tg_audit();
drop trigger if exists trg_audit on public.fixed_asset_depreciation;
create trigger trg_audit after insert or update or delete on public.fixed_asset_depreciation
  for each row execute function app_private.tg_audit();
