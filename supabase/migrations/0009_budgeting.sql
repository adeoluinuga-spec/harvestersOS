-- ===========================================================================
-- Harvesters Finance OS - 0009 Bottom-up budgeting
-- Campus submissions, top-down rollup authority, budget-vs-actual warnings.
-- ===========================================================================

do $$ begin create type public.budget_cycle_status as enum
  ('open_for_submission','under_review','approved','closed');
exception when duplicate_object then null; end $$;

do $$ begin create type public.budget_enforcement_mode as enum
  ('warn','block','none');
exception when duplicate_object then null; end $$;

create table if not exists public.budget_cycles (
  id uuid primary key default gen_random_uuid(),
  fiscal_year int not null unique check (fiscal_year between 2000 and 2200),
  status public.budget_cycle_status not null default 'open_for_submission',
  created_at timestamptz not null default now()
);

create table if not exists public.entity_budget_settings (
  entity_id uuid primary key references public.entities(id) on delete cascade,
  enforcement_mode public.budget_enforcement_mode not null default 'warn',
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  budget_cycle_id uuid not null references public.budget_cycles(id) on delete cascade,
  prior_budget_line_id uuid references public.budget_lines(id) on delete set null,
  entity_id uuid not null references public.entities(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  proposed_amount numeric(18,2) not null check (proposed_amount >= 0),
  approved_amount numeric(18,2) check (approved_amount is null or approved_amount >= 0),
  submitted_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  notes text,
  review_justification text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (budget_cycle_id, entity_id, account_id)
);
create index if not exists idx_budget_lines_cycle_entity on public.budget_lines(budget_cycle_id, entity_id);
create index if not exists idx_budget_lines_account on public.budget_lines(account_id);
create index if not exists idx_budget_lines_prior on public.budget_lines(prior_budget_line_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requisition_budget_line_fk'
      and conrelid = 'public.requisition_requests'::regclass
  ) then
    alter table public.requisition_requests
      add constraint requisition_budget_line_fk
      foreign key (budget_line_id) references public.budget_lines(id) on delete restrict
      not valid;
  end if;
end $$;

create or replace function public.create_budget_cycle_from_prior(p_fiscal_year int)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_cycle uuid; v_prior uuid;
begin
  insert into public.budget_cycles (fiscal_year)
  values (p_fiscal_year)
  on conflict (fiscal_year) do update set fiscal_year = excluded.fiscal_year
  returning id into v_cycle;

  select id into v_prior from public.budget_cycles where fiscal_year = p_fiscal_year - 1;
  if v_prior is not null then
    insert into public.budget_lines
      (budget_cycle_id, prior_budget_line_id, entity_id, account_id, proposed_amount,
       approved_amount, notes)
    select v_cycle, bl.id, bl.entity_id, bl.account_id, bl.approved_amount,
           null, 'Seeded from prior cycle approved amount'
    from public.budget_lines bl
    where bl.budget_cycle_id = v_prior
    on conflict (budget_cycle_id, entity_id, account_id) do nothing;
  end if;
  return v_cycle;
end $$;
revoke all on function public.create_budget_cycle_from_prior(int) from public, anon, authenticated;

create or replace function public.budget_line_actuals(p_budget_line_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(rr.amount), 0)
  from public.requisition_requests rr
  where rr.budget_line_id = p_budget_line_id
    and rr.status not in ('draft','rejected','cancelled');
$$;
revoke all on function public.budget_line_actuals(uuid) from public, anon, authenticated;

create or replace function public.check_budget_requisition(
  p_budget_line_id uuid, p_amount numeric
) returns table (
  enforcement_mode public.budget_enforcement_mode,
  approved_amount numeric,
  running_actual numeric,
  projected_actual numeric,
  exceeds_budget boolean,
  warning text
) language plpgsql stable security definer set search_path = '' as $$
declare bl public.budget_lines; v_mode public.budget_enforcement_mode; v_actual numeric;
begin
  select * into bl from public.budget_lines where id = p_budget_line_id;
  if not found then
    enforcement_mode := 'none'; approved_amount := null; running_actual := 0;
    projected_actual := p_amount; exceeds_budget := false; warning := null;
    return next;
    return;
  end if;

  select coalesce(enforcement_mode, 'warn') into v_mode
  from public.entity_budget_settings where entity_id = bl.entity_id;
  v_mode := coalesce(v_mode, 'warn');
  v_actual := public.budget_line_actuals(p_budget_line_id);

  enforcement_mode := v_mode;
  approved_amount := bl.approved_amount;
  running_actual := v_actual;
  projected_actual := v_actual + p_amount;
  exceeds_budget := bl.approved_amount is not null and projected_actual > bl.approved_amount;
  warning := case
    when exceeds_budget and v_mode = 'block' then 'This requisition exceeds the approved budget and this entity is configured to block over-budget submissions.'
    when exceeds_budget and v_mode = 'warn' then 'This requisition would exceed the approved budget.'
    when bl.approved_amount is null then 'This budget line has not been approved yet.'
    else null
  end;
  return next;
end $$;
revoke all on function public.check_budget_requisition(uuid,numeric) from public, anon, authenticated;

create or replace function public.set_budget_line_review(
  p_budget_line_id uuid, p_approved_amount numeric, p_justification text, p_actor uuid
) returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_justification is null or length(trim(p_justification)) < 3 then
    raise exception 'A justification note is required when reviewing a budget line'
      using errcode = 'check_violation';
  end if;
  update public.budget_lines
     set approved_amount = p_approved_amount,
         review_justification = p_justification,
         reviewed_by = p_actor,
         reviewed_at = now()
   where id = p_budget_line_id;
  if not found then raise exception 'Budget line not found' using errcode = 'check_violation'; end if;
end $$;
revoke all on function public.set_budget_line_review(uuid,numeric,text,uuid)
  from public, anon, authenticated;

create or replace view public.budget_vs_actual_rollup with (security_invoker = true) as
with recursive descendants as (
  select e.id as ancestor_id, e.id as entity_id
  from public.entities e
  union all
  select d.ancestor_id, c.id
  from descendants d
  join public.entities c on c.parent_entity_id = d.entity_id
),
line_actuals as (
  select bl.id as budget_line_id,
         coalesce(sum(rr.amount) filter (where rr.status not in ('draft','rejected','cancelled')), 0) as actual_amount
  from public.budget_lines bl
  left join public.requisition_requests rr on rr.budget_line_id = bl.id
  group by bl.id
)
select bc.id as budget_cycle_id,
       bc.fiscal_year,
       parent.id as entity_id,
       parent.parent_entity_id,
       parent.name as entity_name,
       parent.type as entity_type,
       a.fund_classification,
       sum(bl.proposed_amount) as proposed_amount,
       sum(coalesce(bl.approved_amount, 0)) as approved_amount,
       sum(la.actual_amount) as actual_amount,
       sum(coalesce(bl.approved_amount, 0)) - sum(la.actual_amount) as variance_amount,
       count(bl.id)::int as line_count
from public.budget_cycles bc
join public.budget_lines bl on bl.budget_cycle_id = bc.id
join public.accounts a on a.id = bl.account_id
join line_actuals la on la.budget_line_id = bl.id
join descendants d on d.entity_id = bl.entity_id
join public.entities parent on parent.id = d.ancestor_id
group by bc.id, bc.fiscal_year, parent.id, parent.parent_entity_id, parent.name, parent.type, a.fund_classification;

do $$
declare t text;
begin
  foreach t in array array[
    'budget_cycles','entity_budget_settings','budget_lines'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function app_private.tg_audit()', t);
  end loop;
end $$;

grant select on public.budget_vs_actual_rollup to authenticated;

drop policy if exists budget_cycles_select on public.budget_cycles;
create policy budget_cycles_select on public.budget_cycles for select to authenticated using (true);
drop policy if exists entity_budget_settings_select on public.entity_budget_settings;
create policy entity_budget_settings_select on public.entity_budget_settings for select to authenticated
  using (public.user_can_access_entity(entity_id));
drop policy if exists budget_lines_select on public.budget_lines;
create policy budget_lines_select on public.budget_lines for select to authenticated
  using (public.user_can_access_entity(entity_id));
