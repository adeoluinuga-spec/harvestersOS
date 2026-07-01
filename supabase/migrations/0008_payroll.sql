-- ===========================================================================
-- Harvesters Finance OS - 0008 Payroll and honorariums
-- Clergy/admin staff are first-class payroll data; honorariums are distinct.
-- ===========================================================================

alter type public.source_module add value if not exists 'honorarium';

commit;

do $$ begin create type public.staff_type as enum
  ('minister_clergy','administrative');
exception when duplicate_object then null; end $$;

do $$ begin create type public.employment_status as enum
  ('employed','volunteer_honorarium');
exception when duplicate_object then null; end $$;

do $$ begin create type public.compensation_component_type as enum
  ('base_salary','housing_allowance','transport_allowance','other_allowance');
exception when duplicate_object then null; end $$;

do $$ begin create type public.payroll_run_status as enum
  ('draft','approved','paid');
exception when duplicate_object then null; end $$;

do $$ begin create type public.honorarium_recipient_type as enum
  ('guest_minister','visiting_speaker');
exception when duplicate_object then null; end $$;

do $$ begin create type public.honorarium_status as enum
  ('draft','pending_approval','approved','rejected','paid');
exception when duplicate_object then null; end $$;

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  full_name text not null,
  staff_type public.staff_type not null,
  employment_status public.employment_status not null default 'employed',
  state_of_taxation text,
  pfa_provider text,
  pension_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_staff_entity on public.staff(entity_id);
create index if not exists idx_staff_type on public.staff(staff_type);

create table if not exists public.compensation_components (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  component_type public.compensation_component_type not null,
  amount numeric(18,2) not null check (amount >= 0),
  currency char(3) not null,
  is_taxable boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_comp_staff on public.compensation_components(staff_id);

create table if not exists public.payroll_tax_rules (
  id uuid primary key default gen_random_uuid(),
  state_of_taxation text not null,
  staff_type public.staff_type not null,
  taxable_income_min numeric(18,2) not null default 0,
  taxable_income_max numeric(18,2),
  paye_rate numeric(7,4) not null default 0,
  pension_rate numeric(7,4) not null default 0,
  nhf_rate numeric(7,4) not null default 0,
  relief_amount numeric(18,2) not null default 0,
  effective_from date not null default current_date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint tax_rule_rates check (
    paye_rate >= 0 and pension_rate >= 0 and nhf_rate >= 0
    and paye_rate <= 100 and pension_rate <= 100 and nhf_rate <= 100
  )
);
create index if not exists idx_payroll_tax_rules_lookup
  on public.payroll_tax_rules(state_of_taxation, staff_type, is_active, effective_from);
create unique index if not exists payroll_tax_rules_seed_uniq
  on public.payroll_tax_rules(
    lower(state_of_taxation), staff_type, taxable_income_min,
    coalesce(taxable_income_max, -1), effective_from
  );

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  period_month int not null check (period_month between 1 and 12),
  period_year int not null check (period_year between 2000 and 2200),
  status public.payroll_run_status not null default 'draft',
  approved_by uuid references auth.users(id),
  journal_entry_id uuid references public.journal_entries(id) on delete restrict,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  unique (entity_id, period_month, period_year)
);
create index if not exists idx_payroll_runs_entity_status on public.payroll_runs(entity_id, status);

create table if not exists public.payroll_line_items (
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  gross_amount numeric(18,2) not null,
  taxable_amount numeric(18,2) not null default 0,
  paye_deducted numeric(18,2) not null default 0,
  pension_deducted numeric(18,2) not null default 0,
  nhf_deducted numeric(18,2) not null default 0,
  net_amount numeric(18,2) not null,
  primary key (payroll_run_id, staff_id)
);
create index if not exists idx_payroll_lines_staff on public.payroll_line_items(staff_id);

create table if not exists public.honorarium_approval_rules (
  id uuid primary key default gen_random_uuid(),
  threshold_min numeric(18,2) not null default 0,
  threshold_max numeric(18,2),
  approver_role public.app_role not null,
  sequence_order int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (threshold_min, threshold_max, approver_role, sequence_order)
);

create table if not exists public.honorarium_payments (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  recipient_name text not null,
  recipient_type public.honorarium_recipient_type not null,
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null,
  event_id uuid references public.entities(id) on delete restrict,
  wht_applicable boolean not null default false,
  wht_amount numeric(18,2) not null default 0,
  payment_date date not null default current_date,
  status public.honorarium_status not null default 'pending_approval',
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  journal_entry_id uuid references public.journal_entries(id) on delete restrict,
  rejection_reason text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  constraint honorarium_wht_nonneg check (wht_amount >= 0 and wht_amount <= amount)
);
create index if not exists idx_honorarium_entity_status on public.honorarium_payments(entity_id, status);

create table if not exists public.honorarium_approvals (
  id uuid primary key default gen_random_uuid(),
  honorarium_payment_id uuid not null references public.honorarium_payments(id) on delete cascade,
  approver_role public.app_role not null,
  approver_user_id uuid references auth.users(id),
  sequence_order int not null,
  status public.approval_status not null default 'pending',
  decided_at timestamptz,
  comments text
);
create index if not exists idx_honorarium_approvals_role_status
  on public.honorarium_approvals(approver_role, status);

create or replace function public.create_payroll_run(
  p_entity_id uuid, p_period_month int, p_period_year int, p_actor uuid default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run uuid;
  s record;
  v_gross numeric(18,2);
  v_taxable numeric(18,2);
  v_rule public.payroll_tax_rules;
  v_paye numeric(18,2);
  v_pension numeric(18,2);
  v_nhf numeric(18,2);
begin
  insert into public.payroll_runs (entity_id, period_month, period_year, created_by)
  values (p_entity_id, p_period_month, p_period_year, p_actor)
  on conflict (entity_id, period_month, period_year) do update
    set created_by = coalesce(public.payroll_runs.created_by, excluded.created_by)
  returning id into v_run;

  delete from public.payroll_line_items where payroll_run_id = v_run;

  for s in
    select * from public.staff
    where entity_id = p_entity_id and employment_status = 'employed'
    order by full_name
  loop
    select coalesce(sum(amount),0),
           coalesce(sum(amount) filter (where is_taxable),0)
      into v_gross, v_taxable
    from public.compensation_components where staff_id = s.id;

    select * into v_rule
    from public.payroll_tax_rules r
    where r.is_active
      and lower(r.state_of_taxation) = lower(coalesce(s.state_of_taxation, 'default'))
      and r.staff_type = s.staff_type
      and v_taxable >= r.taxable_income_min
      and (r.taxable_income_max is null or v_taxable <= r.taxable_income_max)
      and r.effective_from <= make_date(p_period_year, p_period_month, 1)
    order by r.effective_from desc, r.taxable_income_min desc
    limit 1;

    if not found then
      select * into v_rule
      from public.payroll_tax_rules r
      where r.is_active and lower(r.state_of_taxation) = 'default'
        and r.staff_type = s.staff_type
      order by r.effective_from desc, r.taxable_income_min desc
      limit 1;
    end if;

    v_paye := greatest(round((v_taxable - coalesce(v_rule.relief_amount,0)) * coalesce(v_rule.paye_rate,0) / 100, 2), 0);
    v_pension := greatest(round(v_gross * coalesce(v_rule.pension_rate,0) / 100, 2), 0);
    v_nhf := greatest(round(v_gross * coalesce(v_rule.nhf_rate,0) / 100, 2), 0);

    insert into public.payroll_line_items
      (payroll_run_id, staff_id, gross_amount, taxable_amount, paye_deducted,
       pension_deducted, nhf_deducted, net_amount)
    values
      (v_run, s.id, v_gross, v_taxable, v_paye, v_pension, v_nhf,
       greatest(v_gross - v_paye - v_pension - v_nhf, 0));
  end loop;

  return v_run;
end $$;
revoke all on function public.create_payroll_run(uuid,int,int,uuid) from public, anon, authenticated;

create or replace function public.approve_payroll_run(p_run_id uuid, p_actor uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  v_expense uuid;
  v_bank uuid;
  v_liability uuid;
  v_currency text;
  v_gross numeric(18,2);
  v_deductions numeric(18,2);
  v_net numeric(18,2);
  v_je uuid;
begin
  select * into r from public.payroll_runs where id = p_run_id for update;
  if not found or r.status <> 'draft' then
    raise exception 'Payroll run is not in draft state' using errcode = 'check_violation';
  end if;
  if r.created_by is not null and r.created_by = p_actor then
    raise exception 'Segregation of duties: creator cannot approve payroll run' using errcode = 'check_violation';
  end if;

  select coalesce(sum(gross_amount),0), coalesce(sum(paye_deducted + pension_deducted + nhf_deducted),0),
         coalesce(sum(net_amount),0)
    into v_gross, v_deductions, v_net
  from public.payroll_line_items where payroll_run_id = p_run_id;
  if v_gross <= 0 then raise exception 'Payroll run has no payable line items' using errcode = 'check_violation'; end if;

  select functional_currency into v_currency from public.entities where id = r.entity_id;
  select id into v_expense from public.accounts where code = '5000';
  select id into v_liability from public.accounts where code = '2100';
  select id into v_bank from public.accounts where code = '1010';

  insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
  values (r.entity_id, current_date, 'Payroll run ' || r.period_month::text || '/' || r.period_year::text,
          'payroll', r.created_by, 'draft')
  returning id into v_je;

  insert into public.journal_entry_lines
    (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
  values
    (v_je, v_expense, r.entity_id, v_gross, 0, 'unrestricted', v_currency),
    (v_je, v_bank, r.entity_id, 0, v_net, 'unrestricted', v_currency);

  if v_deductions > 0 then
    insert into public.journal_entry_lines
      (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
    values (v_je, v_liability, r.entity_id, 0, v_deductions, 'unrestricted', v_currency);
  end if;

  update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_je;
  update public.payroll_runs
     set status = 'approved', approved_by = p_actor, approved_at = now(), journal_entry_id = v_je
   where id = p_run_id;
  return v_je;
end $$;
revoke all on function public.approve_payroll_run(uuid,uuid) from public, anon, authenticated;

create or replace function public.generate_honorarium_approvals(p_honorarium_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare h public.honorarium_payments;
begin
  select * into h from public.honorarium_payments where id = p_honorarium_id;
  if not found then raise exception 'Honorarium not found' using errcode = 'check_violation'; end if;

  insert into public.honorarium_approvals (honorarium_payment_id, approver_role, sequence_order)
  select h.id, r.approver_role, r.sequence_order
  from public.honorarium_approval_rules r
  where r.is_active
    and h.amount >= r.threshold_min
    and (r.threshold_max is null or h.amount <= r.threshold_max)
  order by r.sequence_order;

  if not exists (select 1 from public.honorarium_approvals where honorarium_payment_id = h.id) then
    insert into public.honorarium_approvals (honorarium_payment_id, approver_role, sequence_order)
    values (h.id, 'cfo_coo', 1);
  end if;
end $$;
revoke all on function public.generate_honorarium_approvals(uuid) from public, anon, authenticated;

create or replace function public.decide_honorarium_approval(
  p_approval_id uuid, p_actor uuid, p_decision public.approval_status, p_comments text default null
) returns void language plpgsql volatile security definer set search_path = '' as $$
declare a public.honorarium_approvals; h public.honorarium_payments; v_all_approved boolean;
begin
  select * into a from public.honorarium_approvals where id = p_approval_id for update;
  if not found or a.status <> 'pending' then raise exception 'Approval is not pending' using errcode = 'check_violation'; end if;
  select * into h from public.honorarium_payments where id = a.honorarium_payment_id;
  if h.created_by is not null and h.created_by = p_actor then
    raise exception 'Segregation of duties: creator cannot approve honorarium' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.honorarium_approvals prev
    where prev.honorarium_payment_id = a.honorarium_payment_id
      and prev.sequence_order < a.sequence_order and prev.status <> 'approved'
  ) then raise exception 'Prior approval steps are not complete' using errcode = 'check_violation'; end if;

  update public.honorarium_approvals
     set status = p_decision, approver_user_id = p_actor, decided_at = now(), comments = p_comments
   where id = p_approval_id;

  if p_decision = 'rejected' then
    update public.honorarium_payments
       set status = 'rejected', rejection_reason = p_comments
     where id = a.honorarium_payment_id;
    return;
  end if;

  select not exists (
    select 1 from public.honorarium_approvals
    where honorarium_payment_id = a.honorarium_payment_id and status <> 'approved'
  ) into v_all_approved;
  if v_all_approved then
    update public.honorarium_payments
       set status = 'approved', approved_by = p_actor, approved_at = now()
     where id = a.honorarium_payment_id;
  end if;
end $$;
revoke all on function public.decide_honorarium_approval(uuid,uuid,public.approval_status,text)
  from public, anon, authenticated;

create or replace function public.post_honorarium_payment(p_honorarium_id uuid, p_actor uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  h public.honorarium_payments;
  v_expense uuid;
  v_bank uuid;
  v_liability uuid;
  v_net numeric(18,2);
  v_je uuid;
begin
  select * into h from public.honorarium_payments where id = p_honorarium_id for update;
  if not found or h.status <> 'approved' then
    raise exception 'Honorarium must be approved before posting' using errcode = 'check_violation';
  end if;
  v_net := h.amount - h.wht_amount;
  select id into v_expense from public.accounts where code = '5030';
  select id into v_liability from public.accounts where code = '2000';
  select id into v_bank from public.accounts where code = '1010';

  insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
  values (h.entity_id, h.payment_date, 'Honorarium: ' || h.recipient_name, 'honorarium', h.created_by, 'draft')
  returning id into v_je;

  insert into public.journal_entry_lines
    (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
  values
    (v_je, v_expense, h.entity_id, h.amount, 0, 'unrestricted', h.currency),
    (v_je, v_bank, h.entity_id, 0, v_net, 'unrestricted', h.currency);

  if h.wht_amount > 0 then
    insert into public.journal_entry_lines
      (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
    values (v_je, v_liability, h.entity_id, 0, h.wht_amount, 'unrestricted', h.currency);
  end if;

  update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_je;
  update public.honorarium_payments
     set status = 'paid', journal_entry_id = v_je, paid_at = now()
   where id = p_honorarium_id;
  return v_je;
end $$;
revoke all on function public.post_honorarium_payment(uuid,uuid) from public, anon, authenticated;

insert into public.payroll_tax_rules
  (state_of_taxation, staff_type, taxable_income_min, taxable_income_max, paye_rate, pension_rate, nhf_rate, relief_amount)
values
  ('default','minister_clergy',0,null,5,0,0,0),
  ('default','administrative',0,null,7.5,8,2.5,0)
on conflict do nothing;

insert into public.honorarium_approval_rules
  (threshold_min, threshold_max, approver_role, sequence_order)
values
  (0, 999999.99, 'cfo_coo', 1),
  (1000000, null, 'global_lead_pastor', 1)
on conflict do nothing;

do $$
declare t text;
begin
  foreach t in array array[
    'staff','compensation_components','payroll_tax_rules','payroll_runs',
    'payroll_line_items','honorarium_approval_rules','honorarium_payments',
    'honorarium_approvals'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function app_private.tg_audit()', t);
  end loop;
end $$;

drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff for select to authenticated
  using (public.user_can_access_entity(entity_id));
drop policy if exists compensation_select on public.compensation_components;
create policy compensation_select on public.compensation_components for select to authenticated
  using (exists (select 1 from public.staff s where s.id = staff_id and public.user_can_access_entity(s.entity_id)));
drop policy if exists payroll_tax_rules_select on public.payroll_tax_rules;
create policy payroll_tax_rules_select on public.payroll_tax_rules for select to authenticated using (true);
drop policy if exists payroll_runs_select on public.payroll_runs;
create policy payroll_runs_select on public.payroll_runs for select to authenticated
  using (public.user_can_access_entity(entity_id));
drop policy if exists payroll_line_items_select on public.payroll_line_items;
create policy payroll_line_items_select on public.payroll_line_items for select to authenticated
  using (exists (
    select 1 from public.payroll_runs pr
    where pr.id = payroll_run_id and public.user_can_access_entity(pr.entity_id)
  ));
drop policy if exists honorarium_rules_select on public.honorarium_approval_rules;
create policy honorarium_rules_select on public.honorarium_approval_rules for select to authenticated using (true);
drop policy if exists honorarium_select on public.honorarium_payments;
create policy honorarium_select on public.honorarium_payments for select to authenticated
  using (public.user_can_access_entity(entity_id));
drop policy if exists honorarium_approvals_select on public.honorarium_approvals;
create policy honorarium_approvals_select on public.honorarium_approvals for select to authenticated using (true);
