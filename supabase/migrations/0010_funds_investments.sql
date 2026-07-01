-- ===========================================================================
-- Harvesters Finance OS - 0010 Fund accounting and investments
-- Named restricted funds, allowed-use enforcement, formal loans, investments.
-- ===========================================================================

do $$ begin create type public.inter_fund_loan_status as enum
  ('active','repaid','forgiven');
exception when duplicate_object then null; end $$;

do $$ begin create type public.investment_type as enum
  ('fixed_deposit','treasury_bill','other');
exception when duplicate_object then null; end $$;

do $$ begin create type public.investment_status as enum
  ('active','matured','liquidated');
exception when duplicate_object then null; end $$;

create table if not exists public.restricted_funds (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  name text not null,
  fund_classification public.fund_classification not null,
  target_amount numeric(18,2) not null default 0 check (target_amount >= 0),
  purpose_description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint restricted_funds_classification check (
    fund_classification in ('temporarily_restricted','permanently_restricted','board_designated')
  ),
  unique (entity_id, name)
);
create index if not exists idx_restricted_funds_entity on public.restricted_funds(entity_id);

create table if not exists public.restricted_fund_allowed_uses (
  restricted_fund_id uuid not null references public.restricted_funds(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (restricted_fund_id, account_id)
);

create table if not exists public.inter_fund_loans (
  id uuid primary key default gen_random_uuid(),
  lending_entity_id uuid not null references public.entities(id) on delete restrict,
  lending_fund uuid references public.restricted_funds(id) on delete restrict,
  borrowing_entity_id uuid not null references public.entities(id) on delete restrict,
  borrowing_purpose text not null,
  principal_amount numeric(18,2) not null check (principal_amount > 0),
  currency char(3) not null,
  date_issued date not null default current_date,
  repayment_schedule jsonb not null default '[]'::jsonb,
  status public.inter_fund_loan_status not null default 'active',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists idx_inter_fund_loans_lender on public.inter_fund_loans(lending_entity_id, status);
create index if not exists idx_inter_fund_loans_borrower on public.inter_fund_loans(borrowing_entity_id, status);

create table if not exists public.investments (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  investment_type public.investment_type not null,
  institution text not null,
  principal_amount numeric(18,2) not null check (principal_amount > 0),
  currency char(3) not null,
  interest_rate numeric(9,4) not null default 0 check (interest_rate >= 0),
  start_date date not null,
  maturity_date date not null,
  status public.investment_status not null default 'active',
  actual_return_amount numeric(18,2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint investments_dates check (maturity_date >= start_date)
);
create index if not exists idx_investments_entity_status on public.investments(entity_id, status);
create index if not exists idx_investments_maturity on public.investments(maturity_date, status);

create table if not exists public.investment_maturity_alerts (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null references public.investments(id) on delete cascade,
  alert_date date not null default current_date,
  days_to_maturity int not null,
  status text not null default 'open' check (status in ('open','dismissed')),
  created_at timestamptz not null default now(),
  unique (investment_id, alert_date)
);

create or replace view public.restricted_fund_balances with (security_invoker = true) as
select rf.id,
       rf.entity_id,
       e.name as entity_name,
       rf.name,
       rf.fund_classification,
       rf.target_amount,
       rf.purpose_description,
       coalesce(sum(jel.credit_amount - jel.debit_amount), 0) as current_balance,
       case when rf.target_amount > 0
            then round(coalesce(sum(jel.credit_amount - jel.debit_amount), 0) * 100 / rf.target_amount, 2)
            else null end as percent_funded
from public.restricted_funds rf
join public.entities e on e.id = rf.entity_id
left join public.journal_entry_lines jel
  on jel.entity_id = rf.entity_id and jel.fund_classification = rf.fund_classification
left join public.journal_entries je
  on je.id = jel.journal_entry_id and je.status = 'posted'
group by rf.id, e.name;

create or replace view public.restricted_fund_recent_activity with (security_invoker = true) as
select rf.id as restricted_fund_id,
       je.id as journal_entry_id,
       je.transaction_date,
       je.description,
       a.code as account_code,
       a.name as account_name,
       jel.debit_amount,
       jel.credit_amount,
       jel.currency
from public.restricted_funds rf
join public.journal_entry_lines jel
  on jel.entity_id = rf.entity_id and jel.fund_classification = rf.fund_classification
join public.journal_entries je on je.id = jel.journal_entry_id and je.status = 'posted'
join public.accounts a on a.id = jel.account_id;

create or replace view public.investment_yield_tracking with (security_invoker = true) as
select i.id,
       i.entity_id,
       e.name as entity_name,
       i.investment_type,
       i.institution,
       i.principal_amount,
       i.currency,
       i.interest_rate,
       i.start_date,
       i.maturity_date,
       i.status,
       round(i.principal_amount * (i.interest_rate / 100)
             * greatest((i.maturity_date - i.start_date), 0) / 365, 2) as expected_return_amount,
       i.actual_return_amount,
       i.actual_return_amount - round(i.principal_amount * (i.interest_rate / 100)
             * greatest((i.maturity_date - i.start_date), 0) / 365, 2) as return_variance_amount,
       (i.maturity_date - current_date)::int as days_to_maturity
from public.investments i
join public.entities e on e.id = i.entity_id;

create or replace function public.refresh_investment_maturity_alerts(p_window_days int default 30)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare v_count int;
begin
  insert into public.investment_maturity_alerts (investment_id, alert_date, days_to_maturity)
  select i.id, current_date, (i.maturity_date - current_date)::int
  from public.investments i
  where i.status = 'active'
    and i.maturity_date between current_date and current_date + p_window_days
  on conflict (investment_id, alert_date) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.refresh_investment_maturity_alerts(int) from public, anon, authenticated;

create or replace function public.assert_restricted_fund_allowed_use(
  p_entity_id uuid, p_fund_classification public.fund_classification, p_account_id uuid
) returns void language plpgsql stable security definer set search_path = '' as $$
declare v_account_type public.account_type; v_allowed boolean;
begin
  if p_fund_classification not in ('temporarily_restricted','permanently_restricted') then
    return;
  end if;

  select account_type into v_account_type from public.accounts where id = p_account_id;
  if v_account_type is distinct from 'expense' then
    return;
  end if;

  select exists (
    select 1
    from public.restricted_funds rf
    join public.restricted_fund_allowed_uses au on au.restricted_fund_id = rf.id
    where rf.entity_id = p_entity_id
      and rf.fund_classification = p_fund_classification
      and rf.is_active
      and au.account_id = p_account_id
  ) into v_allowed;

  if not v_allowed then
    raise exception 'Restricted fund % cannot be spent against this expense account until explicitly whitelisted',
      p_fund_classification using errcode = 'check_violation';
  end if;
end $$;
revoke all on function public.assert_restricted_fund_allowed_use(uuid,public.fund_classification,uuid)
  from public, anon, authenticated;

create or replace function app_private.tg_restricted_fund_allowed_use()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.debit_amount > 0 then
    perform public.assert_restricted_fund_allowed_use(new.entity_id, new.fund_classification, new.account_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_restricted_fund_allowed_use on public.journal_entry_lines;
create trigger trg_restricted_fund_allowed_use
  before insert or update on public.journal_entry_lines
  for each row execute function app_private.tg_restricted_fund_allowed_use();

do $$
declare t text;
begin
  foreach t in array array[
    'restricted_funds','restricted_fund_allowed_uses','inter_fund_loans',
    'investments','investment_maturity_alerts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function app_private.tg_audit()', t);
  end loop;
end $$;

grant select on public.restricted_fund_balances,
                public.restricted_fund_recent_activity,
                public.investment_yield_tracking
  to authenticated;

drop policy if exists restricted_funds_select on public.restricted_funds;
create policy restricted_funds_select on public.restricted_funds for select to authenticated
  using (public.user_can_access_entity(entity_id));
drop policy if exists restricted_fund_allowed_uses_select on public.restricted_fund_allowed_uses;
create policy restricted_fund_allowed_uses_select on public.restricted_fund_allowed_uses for select to authenticated
  using (exists (
    select 1 from public.restricted_funds rf
    where rf.id = restricted_fund_id and public.user_can_access_entity(rf.entity_id)
  ));
drop policy if exists inter_fund_loans_select on public.inter_fund_loans;
create policy inter_fund_loans_select on public.inter_fund_loans for select to authenticated
  using (public.user_can_access_entity(lending_entity_id) or public.user_can_access_entity(borrowing_entity_id));
drop policy if exists investments_select on public.investments;
create policy investments_select on public.investments for select to authenticated
  using (public.user_can_access_entity(entity_id));
drop policy if exists investment_alerts_select on public.investment_maturity_alerts;
create policy investment_alerts_select on public.investment_maturity_alerts for select to authenticated
  using (exists (
    select 1 from public.investments i
    where i.id = investment_id and public.user_can_access_entity(i.entity_id)
  ));
