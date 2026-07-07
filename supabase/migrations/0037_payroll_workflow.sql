-- ===========================================================================
-- Harvesters Finance OS — 0037 Federated payroll workflow
--
-- Encodes how Harvesters actually pays people:
--   • Payroll is FEDERATED: campus staff are paid by their campus, central
--     staff by the central office, ministry staff by their ministry. HR
--     (new hr_officer role) PREPARES per entity; the CAMPUS PASTOR /
--     MINISTRY HEAD approves (single approval, SoD-enforced); finance
--     uploads to the bank; the ACCOUNT-SPECIFIC signatories confirm
--     (same slot model as expense disbursements); staff get paid.
--   • Everyone is paid in TWO half-salary cycles: the 13th and the 26th.
--     Approval automatically spawns both payment batches with a 50/50
--     split per staff line (rounding kobo lands on the second half).
--   • Accounting is TWO-step: approval posts the ACCRUAL (expense +
--     salaries payable + statutory liabilities); each batch disbursement
--     posts the PAYMENT (payable down, bank down). A RETURNED payment
--     posts the correction (bank back up, still owed) — the ledger never
--     pretends a bounced salary was paid.
--   • Per-payment status: successful / returned / contested / reissued,
--     with a rollup for the campus/ministry payment-status board.
--   • The nightly job announces each cycle ahead of time and escalates
--     entities whose runs are not prepared/approved as the date closes in.
-- ===========================================================================

-- --- Accounts: split statutory liabilities from net salaries owed ----------
insert into public.accounts (code, name, account_type, fund_classification)
select '2110', 'Salaries Payable', 'liability', 'unrestricted'
where not exists (select 1 from public.accounts where code = '2110');

-- --- New enums (created fresh; usable immediately) ---------------------------
do $$ begin create type public.payroll_batch_status as enum
  ('pending_upload','pending_signatures','fully_signed','disbursed');
exception when duplicate_object then null; end $$;

do $$ begin create type public.payroll_payment_status as enum
  ('pending','uploaded','successful','returned','contested','reissued');
exception when duplicate_object then null; end $$;

do $$ begin create type public.payroll_adjustment_kind as enum
  ('earning','deduction');
exception when duplicate_object then null; end $$;

-- --- Org-wide payroll settings (singleton) -----------------------------------
create table if not exists public.payroll_settings (
  id               int primary key default 1 check (id = 1),
  cycle_day_1      int not null default 13 check (cycle_day_1 between 1 and 28),
  cycle_day_2      int not null default 26 check (cycle_day_2 between 1 and 28),
  lead_days        int not null default 5,
  escalation_days  int not null default 2,
  updated_at       timestamptz not null default now()
);
insert into public.payroll_settings (id) values (1) on conflict (id) do nothing;

-- --- Run lifecycle columns ------------------------------------------------------
alter table public.payroll_runs
  add column if not exists submitted_by uuid references auth.users(id),
  add column if not exists submitted_at timestamptz,
  add column if not exists approver_role public.app_role,
  add column if not exists rejection_reason text;

-- --- Per-staff one-off adjustments (bonus, overtime, loan, co-op, absence) -----
create table if not exists public.payroll_adjustments (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references public.staff(id) on delete cascade,
  period_month  int not null check (period_month between 1 and 12),
  period_year   int not null check (period_year between 2000 and 2200),
  kind          public.payroll_adjustment_kind not null,
  label         text not null,
  amount        numeric(18,2) not null check (amount > 0),
  is_taxable    boolean not null default false,   -- earnings only
  note          text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_payroll_adj_staff_period
  on public.payroll_adjustments(staff_id, period_year, period_month);

-- Line detail for adjustments.
alter table public.payroll_line_items
  add column if not exists earnings_adjustment numeric(18,2) not null default 0,
  add column if not exists other_deductions numeric(18,2) not null default 0;

-- --- Payment batches (one per cycle) + per-staff payments ------------------------
create table if not exists public.payroll_payment_batches (
  id                             uuid primary key default gen_random_uuid(),
  payroll_run_id                 uuid not null references public.payroll_runs(id) on delete restrict,
  entity_id                      uuid not null references public.entities(id) on delete restrict,
  planned_date                   date not null,          -- the 13th / 26th
  cycle_no                       int not null check (cycle_no in (1, 2, 3)), -- 3 = supplementary
  bank_account_id                uuid references public.bank_accounts(id) on delete restrict,
  bank_upload_reference          text,
  transfer_instruction_reference text,
  total_amount                   numeric(18,2) not null default 0,
  status                         public.payroll_batch_status not null default 'pending_upload',
  payment_journal_entry_id       uuid references public.journal_entries(id) on delete restrict,
  uploaded_by                    uuid references auth.users(id),
  uploaded_at                    timestamptz,
  disbursed_at                   timestamptz,
  created_at                     timestamptz not null default now(),
  unique (payroll_run_id, cycle_no)
);
create index if not exists idx_ppb_entity_status on public.payroll_payment_batches(entity_id, status);
create index if not exists idx_ppb_planned on public.payroll_payment_batches(planned_date);

create table if not exists public.payroll_line_payments (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid references public.payroll_payment_batches(id) on delete restrict,
  payroll_run_id  uuid not null,
  staff_id        uuid not null,
  amount          numeric(18,2) not null check (amount > 0),
  status          public.payroll_payment_status not null default 'pending',
  status_note     text,
  marked_by       uuid references auth.users(id),
  marked_at       timestamptz,
  reissue_of      uuid references public.payroll_line_payments(id),
  correction_journal_entry_id uuid references public.journal_entries(id),
  created_at      timestamptz not null default now(),
  foreign key (payroll_run_id, staff_id)
    references public.payroll_line_items(payroll_run_id, staff_id) on delete restrict
);
create index if not exists idx_plp_batch on public.payroll_line_payments(batch_id);
create index if not exists idx_plp_run_staff on public.payroll_line_payments(payroll_run_id, staff_id);
create index if not exists idx_plp_status on public.payroll_line_payments(status);

-- Account-specific signatories: same slot model as expense disbursements.
create table if not exists public.payroll_batch_signatures (
  batch_id          uuid not null references public.payroll_payment_batches(id) on delete cascade,
  slot_id           uuid not null references public.disbursement_signature_slots(id) on delete restrict,
  signatory_user_id uuid not null references auth.users(id),
  signed_at         timestamptz not null default now(),
  primary key (batch_id, slot_id, signatory_user_id)
);

-- --- Documents may now attach to payroll -----------------------------------------
alter table public.documents drop constraint if exists documents_subject_type_check;
alter table public.documents add constraint documents_subject_type_check
  check (subject_type in
    ('requisition','vendor','journal_entry','cross_border_transfer',
     'investment','giver','fixed_asset','payroll_run','payroll_batch','other'));

-- ---------------------------------------------------------------------------
-- Helper: notify everyone holding a role over an entity (in-app + email queue)
-- ---------------------------------------------------------------------------
create or replace function app_private.notify_role_at_entity(
  p_role public.app_role, p_entity uuid, p_title text, p_body text,
  p_href text, p_kind text
) returns void language plpgsql volatile set search_path = '' as $$
declare u record;
begin
  insert into public.notifications (user_id, role, entity_id, title, body, href)
  values (null, p_role, p_entity, p_title, p_body, p_href);

  for u in
    with recursive up as (
      select id, parent_entity_id from public.entities where id = p_entity
      union all
      select e.id, e.parent_entity_id from public.entities e join up on e.id = up.parent_entity_id
    )
    select distinct au.id, au.email
    from public.user_entity_roles uer
    join auth.users au on au.id = uer.user_id
    where uer.role = p_role
      and (uer.entity_id is null or uer.entity_id in (select id from up))
      and au.email is not null
  loop
    insert into public.message_outbox
      (channel, to_contact, to_user_id, subject, body, kind, entity_id, created_by)
    values ('email', u.email, u.id, p_title, p_body, p_kind, p_entity, null);
  end loop;
end $$;

-- Who approves payroll for an entity? The pastor/head of that cadre.
create or replace function public.payroll_approver_role(p_entity uuid)
returns public.app_role language sql stable set search_path = '' as $$
  select case e.type
    when 'campus' then 'campus_pastor'::public.app_role
    when 'ministry_directorate' then 'ministry_lead'::public.app_role
    when 'ministry_expression' then 'head_of_expression'::public.app_role
    when 'sub_group' then 'sub_group_pastor'::public.app_role
    when 'group' then case when e.parent_entity_id is null
                           then 'global_lead_pastor'::public.app_role
                           else 'group_pastor'::public.app_role end
    else 'cfo_coo'::public.app_role
  end
  from public.entities e where e.id = p_entity;
$$;

-- ---------------------------------------------------------------------------
-- Run computation v2 — components + one-off adjustments. Draft-only.
-- ---------------------------------------------------------------------------
create or replace function public.create_payroll_run(
  p_entity_id uuid, p_period_month int, p_period_year int, p_actor uuid default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run uuid; v_status public.payroll_run_status;
  s record;
  v_gross numeric(18,2); v_taxable numeric(18,2);
  v_earn numeric(18,2); v_earn_tax numeric(18,2); v_deduct numeric(18,2);
  v_rule public.payroll_tax_rules;
  v_paye numeric(18,2); v_pension numeric(18,2); v_nhf numeric(18,2);
begin
  insert into public.payroll_runs (entity_id, period_month, period_year, created_by)
  values (p_entity_id, p_period_month, p_period_year, p_actor)
  on conflict (entity_id, period_month, period_year) do update
    set created_by = coalesce(public.payroll_runs.created_by, excluded.created_by)
  returning id, status into v_run, v_status;

  if v_status not in ('draft','rejected') then
    raise exception 'Payroll run for this period is already % — it cannot be recomputed', v_status
      using errcode = 'check_violation';
  end if;
  update public.payroll_runs set status = 'draft', rejection_reason = null where id = v_run;

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

    -- One-off adjustments for this period.
    select coalesce(sum(amount) filter (where kind = 'earning'),0),
           coalesce(sum(amount) filter (where kind = 'earning' and is_taxable),0),
           coalesce(sum(amount) filter (where kind = 'deduction'),0)
      into v_earn, v_earn_tax, v_deduct
    from public.payroll_adjustments
    where staff_id = s.id and period_month = p_period_month and period_year = p_period_year;

    v_gross := v_gross + v_earn;
    v_taxable := v_taxable + v_earn_tax;

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
       pension_deducted, nhf_deducted, earnings_adjustment, other_deductions, net_amount)
    values
      (v_run, s.id, v_gross, v_taxable, v_paye, v_pension, v_nhf, v_earn, v_deduct,
       greatest(v_gross - v_paye - v_pension - v_nhf - v_deduct, 0));
  end loop;

  return v_run;
end $$;

-- ---------------------------------------------------------------------------
-- Submit: draft -> pending_approval. Notifies the pastor/head of the cadre.
-- ---------------------------------------------------------------------------
create or replace function public.submit_payroll_run(p_run_id uuid, p_actor uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare r public.payroll_runs; v_role public.app_role; v_entity text; v_total numeric(18,2); v_n int;
begin
  select * into r from public.payroll_runs where id = p_run_id for update;
  if not found or r.status not in ('draft','rejected') then
    raise exception 'Only a draft payroll run can be submitted' using errcode = 'check_violation';
  end if;
  select count(*), coalesce(sum(net_amount),0) into v_n, v_total
  from public.payroll_line_items where payroll_run_id = p_run_id;
  if v_n = 0 or v_total <= 0 then
    raise exception 'Payroll run has no payable line items' using errcode = 'check_violation';
  end if;

  v_role := public.payroll_approver_role(r.entity_id);
  select name into v_entity from public.entities where id = r.entity_id;

  update public.payroll_runs
     set status = 'pending_approval', submitted_by = p_actor, submitted_at = now(),
         approver_role = v_role, rejection_reason = null
   where id = p_run_id;

  perform app_private.notify_role_at_entity(
    v_role, r.entity_id,
    'Payroll approval needed: ' || v_entity || ' — ' || to_char(make_date(r.period_year, r.period_month, 1), 'Mon YYYY'),
    v_n || ' staff · total net ' || to_char(v_total, 'FM999,999,999,990.00') ||
    '. Review and approve so finance can schedule the 13th/26th payments.',
    '/payroll/runs/' || p_run_id, 'payroll_approval');
end $$;

-- ---------------------------------------------------------------------------
-- Reject: back to the preparer with a reason.
-- ---------------------------------------------------------------------------
create or replace function public.reject_payroll_run(p_run_id uuid, p_actor uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run_id for update;
  if not found or r.status <> 'pending_approval' then
    raise exception 'Only a pending run can be rejected' using errcode = 'check_violation';
  end if;
  if coalesce(p_reason, '') = '' then
    raise exception 'A rejection reason is required' using errcode = 'check_violation';
  end if;
  update public.payroll_runs
     set status = 'rejected', rejection_reason = p_reason
   where id = p_run_id;
  if r.submitted_by is not null then
    insert into public.notifications (user_id, entity_id, title, body, href)
    values (r.submitted_by, r.entity_id,
            'Payroll run rejected',
            'Reason: ' || p_reason, '/payroll/runs/' || p_run_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Approve v2: pending_approval -> approved.
--   • SoD: approver ≠ preparer/submitter.
--   • Posts the ACCRUAL: Dr 5000 gross · Cr 2110 net · Cr 2100 deductions.
--   • Spawns BOTH cycle batches with a per-line 50/50 split (kobo on cycle 2).
-- ---------------------------------------------------------------------------
create or replace function public.approve_payroll_run(p_run_id uuid, p_actor uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  st public.payroll_settings;
  v_expense uuid; v_stat_liab uuid; v_sal_liab uuid;
  v_currency text; v_entity_name text;
  v_gross numeric(18,2); v_deductions numeric(18,2); v_net numeric(18,2);
  v_je uuid; v_b1 uuid; v_b2 uuid;
  l record; v_half numeric(18,2);
  v_t1 numeric(18,2) := 0; v_t2 numeric(18,2) := 0;
begin
  select * into r from public.payroll_runs where id = p_run_id for update;
  if not found or r.status <> 'pending_approval' then
    raise exception 'Payroll run must be submitted for approval first' using errcode = 'check_violation';
  end if;
  if p_actor is not null and p_actor in (r.created_by, r.submitted_by) then
    raise exception 'Segregation of duties: the preparer cannot approve this payroll run'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(gross_amount),0),
         coalesce(sum(paye_deducted + pension_deducted + nhf_deducted + other_deductions),0),
         coalesce(sum(net_amount),0)
    into v_gross, v_deductions, v_net
  from public.payroll_line_items where payroll_run_id = p_run_id;
  if v_gross <= 0 then raise exception 'Payroll run has no payable line items' using errcode = 'check_violation'; end if;

  select functional_currency into v_currency from public.entities where id = r.entity_id;
  select name into v_entity_name from public.entities where id = r.entity_id;
  select id into v_expense from public.accounts where code = '5000';
  select id into v_stat_liab from public.accounts where code = '2100';
  select id into v_sal_liab from public.accounts where code = '2110';
  select * into st from public.payroll_settings where id = 1;

  -- Accrual: expense recognized, everything owed sits as liabilities.
  insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
  values (r.entity_id, current_date,
          'Payroll accrual ' || r.period_month::text || '/' || r.period_year::text,
          'payroll', r.created_by, 'draft')
  returning id into v_je;
  insert into public.journal_entry_lines
    (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
  values
    (v_je, v_expense, r.entity_id, v_gross, 0, 'unrestricted', v_currency),
    (v_je, v_sal_liab, r.entity_id, 0, v_net, 'unrestricted', v_currency);
  if v_deductions > 0 then
    insert into public.journal_entry_lines
      (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
    values (v_je, v_stat_liab, r.entity_id, 0, v_deductions, 'unrestricted', v_currency);
  end if;
  update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_je;

  -- Both cycle batches (13th and 26th of the period month).
  insert into public.payroll_payment_batches (payroll_run_id, entity_id, planned_date, cycle_no)
  values (p_run_id, r.entity_id, make_date(r.period_year, r.period_month, st.cycle_day_1), 1)
  returning id into v_b1;
  insert into public.payroll_payment_batches (payroll_run_id, entity_id, planned_date, cycle_no)
  values (p_run_id, r.entity_id, make_date(r.period_year, r.period_month, st.cycle_day_2), 2)
  returning id into v_b2;

  for l in
    select staff_id, net_amount from public.payroll_line_items
    where payroll_run_id = p_run_id and net_amount > 0
  loop
    v_half := round(l.net_amount / 2, 2);
    insert into public.payroll_line_payments (batch_id, payroll_run_id, staff_id, amount)
    values (v_b1, p_run_id, l.staff_id, v_half);
    insert into public.payroll_line_payments (batch_id, payroll_run_id, staff_id, amount)
    values (v_b2, p_run_id, l.staff_id, l.net_amount - v_half);
    v_t1 := v_t1 + v_half;
    v_t2 := v_t2 + (l.net_amount - v_half);
  end loop;
  update public.payroll_payment_batches set total_amount = v_t1 where id = v_b1;
  update public.payroll_payment_batches set total_amount = v_t2 where id = v_b2;

  update public.payroll_runs
     set status = 'approved', approved_by = p_actor, approved_at = now(), journal_entry_id = v_je
   where id = p_run_id;

  -- Finance can now schedule the bank uploads.
  perform app_private.notify_role_at_entity(
    'group_finance_officer', r.entity_id,
    'Payroll approved: ' || v_entity_name || ' — ' || to_char(make_date(r.period_year, r.period_month, 1), 'Mon YYYY'),
    'Net ' || to_char(v_net, 'FM999,999,999,990.00') || ' across two cycles (' ||
    st.cycle_day_1 || 'th & ' || st.cycle_day_2 || 'th). Upload each batch to the bank for signatures.',
    '/payroll/payments', 'payroll_processing');

  return v_je;
end $$;

-- ---------------------------------------------------------------------------
-- Batch: finance uploads to the bank -> account signatories -> disbursed.
-- ---------------------------------------------------------------------------
create or replace function public.mark_payroll_batch_uploaded(
  p_batch_id uuid, p_bank_account_id uuid, p_upload_ref text, p_instruction_ref text, p_actor uuid
) returns void language plpgsql volatile security definer set search_path = '' as $$
declare b public.payroll_payment_batches;
begin
  select * into b from public.payroll_payment_batches where id = p_batch_id for update;
  if not found or b.status <> 'pending_upload' then
    raise exception 'Batch is not awaiting bank upload' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.bank_accounts where id = p_bank_account_id and entity_id = b.entity_id) then
    raise exception 'Select a bank account belonging to the paying entity' using errcode = 'check_violation';
  end if;

  update public.payroll_payment_batches
     set bank_account_id = p_bank_account_id,
         bank_upload_reference = nullif(p_upload_ref, ''),
         transfer_instruction_reference = nullif(p_instruction_ref, ''),
         status = 'pending_signatures', uploaded_by = p_actor, uploaded_at = now()
   where id = p_batch_id;
  update public.payroll_line_payments set status = 'uploaded'
   where batch_id = p_batch_id and status = 'pending';
end $$;

create or replace function public.refresh_payroll_batch_status(p_batch_id uuid)
returns public.payroll_batch_status language plpgsql volatile security definer set search_path = '' as $$
declare v_missing int; v_status public.payroll_batch_status;
begin
  select count(*) into v_missing
  from public.disbursement_signature_slots slot
  join public.payroll_payment_batches b on b.bank_account_id = slot.bank_account_id and b.id = p_batch_id
  where not (
    (slot.requires_all_members and not exists (
      select 1 from public.disbursement_signature_slot_members m
      where m.slot_id = slot.id and not exists (
        select 1 from public.payroll_batch_signatures s
        where s.batch_id = p_batch_id and s.slot_id = slot.id and s.signatory_user_id = m.user_id
      )
    ))
    or (not slot.requires_all_members and exists (
      select 1 from public.payroll_batch_signatures s
      where s.batch_id = p_batch_id and s.slot_id = slot.id
    ))
  );
  v_status := case when v_missing = 0 then 'fully_signed' else 'pending_signatures' end;
  update public.payroll_payment_batches set status = v_status
   where id = p_batch_id and status in ('pending_signatures','fully_signed');
  return v_status;
end $$;

create or replace function public.sign_payroll_batch(p_batch_id uuid, p_actor uuid)
returns public.payroll_batch_status language plpgsql volatile security definer set search_path = '' as $$
declare b public.payroll_payment_batches; v_slot uuid;
begin
  select * into b from public.payroll_payment_batches where id = p_batch_id for update;
  if not found or b.status <> 'pending_signatures' then
    raise exception 'Batch is not awaiting signatures' using errcode = 'check_violation';
  end if;
  select slot.id into v_slot
  from public.disbursement_signature_slots slot
  join public.disbursement_signature_slot_members m on m.slot_id = slot.id
  where slot.bank_account_id = b.bank_account_id and m.user_id = p_actor
  limit 1;
  if v_slot is null then
    raise exception 'You are not a signatory on this bank account' using errcode = 'check_violation';
  end if;
  insert into public.payroll_batch_signatures (batch_id, slot_id, signatory_user_id)
  values (p_batch_id, v_slot, p_actor)
  on conflict do nothing;
  return public.refresh_payroll_batch_status(p_batch_id);
end $$;

create or replace function public.disburse_payroll_batch(p_batch_id uuid, p_actor uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.payroll_payment_batches;
  v_sal_liab uuid; v_bank_acct uuid; v_currency text; v_je uuid;
begin
  select * into b from public.payroll_payment_batches where id = p_batch_id for update;
  if not found or b.status <> 'fully_signed' then
    raise exception 'Batch must be fully signed before disbursement' using errcode = 'check_violation';
  end if;

  select functional_currency into v_currency from public.entities where id = b.entity_id;
  select id into v_sal_liab from public.accounts where code = '2110';
  select id into v_bank_acct from public.accounts where code = '1010';

  -- Payment leg: salaries payable down, bank down.
  insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
  values (b.entity_id, current_date,
          'Payroll payment batch (cycle ' || b.cycle_no || ', ' || to_char(b.planned_date, 'DD Mon YYYY') || ')',
          'payroll', null, 'draft')
  returning id into v_je;
  insert into public.journal_entry_lines
    (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
  values
    (v_je, v_sal_liab, b.entity_id, b.total_amount, 0, 'unrestricted', v_currency),
    (v_je, v_bank_acct, b.entity_id, 0, b.total_amount, 'unrestricted', v_currency);
  update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_je;

  update public.payroll_payment_batches
     set status = 'disbursed', payment_journal_entry_id = v_je, disbursed_at = now()
   where id = p_batch_id;
  -- Optimistic default: bank processed everything; finance flips exceptions.
  update public.payroll_line_payments set status = 'successful'
   where batch_id = p_batch_id and status = 'uploaded';

  -- Runs whose batches are all disbursed are paid.
  update public.payroll_runs pr set status = 'paid', paid_at = now()
   where pr.id = b.payroll_run_id and pr.status = 'approved'
     and not exists (select 1 from public.payroll_payment_batches x
                     where x.payroll_run_id = pr.id and x.status <> 'disbursed');
  return v_je;
end $$;

-- ---------------------------------------------------------------------------
-- Payment outcomes: returned / contested / reissue.
-- ---------------------------------------------------------------------------
create or replace function public.mark_payroll_payment(
  p_payment_id uuid, p_status public.payroll_payment_status, p_note text, p_actor uuid
) returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payroll_line_payments;
  b public.payroll_payment_batches;
  v_sal_liab uuid; v_bank uuid; v_currency text; v_je uuid;
begin
  select * into p from public.payroll_line_payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found' using errcode = 'check_violation'; end if;
  if p_status not in ('successful','returned','contested') then
    raise exception 'Payments can only be marked successful, returned or contested' using errcode = 'check_violation';
  end if;
  if p.status not in ('successful','returned','contested') then
    raise exception 'Payment has not been disbursed yet' using errcode = 'check_violation';
  end if;
  if p.status = p_status then return; end if;
  if p.status = 'returned' and p_status <> 'returned' then
    raise exception 'A returned payment can only be reissued, not re-marked' using errcode = 'check_violation';
  end if;

  -- Returned money: the bank gave it back, the salary is owed again.
  if p_status = 'returned' then
    select * into b from public.payroll_payment_batches where id = p.batch_id;
    select functional_currency into v_currency from public.entities where id = b.entity_id;
    select id into v_sal_liab from public.accounts where code = '2110';
    select id into v_bank from public.accounts where code = '1010';
    insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
    values (b.entity_id, current_date, 'Returned payroll payment (reinstated as payable)', 'payroll', null, 'draft')
    returning id into v_je;
    insert into public.journal_entry_lines
      (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
    values
      (v_je, v_bank, b.entity_id, p.amount, 0, 'unrestricted', v_currency),
      (v_je, v_sal_liab, b.entity_id, 0, p.amount, 'unrestricted', v_currency);
    update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_je;
  end if;

  update public.payroll_line_payments
     set status = p_status, status_note = nullif(p_note, ''), marked_by = p_actor, marked_at = now(),
         correction_journal_entry_id = coalesce(v_je, correction_journal_entry_id)
   where id = p_payment_id;
end $$;

create or replace function public.reissue_payroll_payment(p_payment_id uuid, p_actor uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare p public.payroll_line_payments; v_new uuid;
begin
  select * into p from public.payroll_line_payments where id = p_payment_id for update;
  if not found or p.status <> 'returned' then
    raise exception 'Only a returned payment can be reissued' using errcode = 'check_violation';
  end if;
  insert into public.payroll_line_payments
    (batch_id, payroll_run_id, staff_id, amount, status, reissue_of)
  values (null, p.payroll_run_id, p.staff_id, p.amount, 'pending', p.id)
  returning id into v_new;
  update public.payroll_line_payments
     set status = 'reissued', marked_by = p_actor, marked_at = now()
   where id = p_payment_id;
  return v_new;
end $$;

-- Supplementary batch: sweeps an entity's unbatched pending payments.
create or replace function public.create_supplementary_payroll_batch(
  p_entity_id uuid, p_planned_date date, p_actor uuid
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_batch uuid; v_total numeric(18,2); v_run uuid;
begin
  select plp.payroll_run_id into v_run
  from public.payroll_line_payments plp
  join public.payroll_runs pr on pr.id = plp.payroll_run_id
  where pr.entity_id = p_entity_id and plp.batch_id is null and plp.status = 'pending'
  limit 1;
  if v_run is null then
    raise exception 'No unbatched pending payments for this entity' using errcode = 'check_violation';
  end if;

  insert into public.payroll_payment_batches (payroll_run_id, entity_id, planned_date, cycle_no)
  values (v_run, p_entity_id, p_planned_date, 3)
  on conflict (payroll_run_id, cycle_no) do update set planned_date = excluded.planned_date
  returning id into v_batch;

  update public.payroll_line_payments plp set batch_id = v_batch
  from public.payroll_runs pr
  where pr.id = plp.payroll_run_id and pr.entity_id = p_entity_id
    and plp.batch_id is null and plp.status = 'pending';

  select coalesce(sum(amount),0) into v_total
  from public.payroll_line_payments where batch_id = v_batch;
  update public.payroll_payment_batches set total_amount = v_total where id = v_batch;
  return v_batch;
end $$;

-- ---------------------------------------------------------------------------
-- Cycle notifications: announce collation ahead of the 13th/26th; escalate
-- entities not ready as the date closes in. Called by the nightly job.
-- ---------------------------------------------------------------------------
create or replace function public.notify_payroll_cycles()
returns int language plpgsql volatile security definer set search_path = '' as $$
declare
  st public.payroll_settings;
  v_cycle date; v_days int; v_count int := 0;
  e record;
  v_title text;
begin
  select * into st from public.payroll_settings where id = 1;

  for v_cycle in
    select d from (values
      (make_date(extract(year from current_date)::int, extract(month from current_date)::int, st.cycle_day_1)),
      (make_date(extract(year from current_date)::int, extract(month from current_date)::int, st.cycle_day_2)),
      (make_date(extract(year from current_date + interval '1 month')::int,
                 extract(month from current_date + interval '1 month')::int, st.cycle_day_1))
    ) as t(d)
    where d >= current_date and d - current_date <= st.lead_days
  loop
    v_days := v_cycle - current_date;

    for e in
      select distinct s.entity_id, en.name
      from public.staff s
      join public.entities en on en.id = s.entity_id
      where s.employment_status = 'employed'
        and not exists (
          select 1 from public.payroll_runs pr
          where pr.entity_id = s.entity_id
            and pr.period_month = extract(month from v_cycle)::int
            and pr.period_year = extract(year from v_cycle)::int
            and pr.status in ('pending_approval','approved','paid')
        )
    loop
      v_title := 'Payroll cycle ' || to_char(v_cycle, 'DD Mon') || ': ' || e.name || ' not ready';
      if exists (select 1 from public.notifications
                 where title = v_title and created_at > now() - interval '24 hours') then
        continue;
      end if;
      -- Preparers first; escalate to oversight when close.
      perform app_private.notify_role_at_entity(
        'hr_officer', e.entity_id, v_title,
        'The ' || to_char(v_cycle, 'DD Mon') || ' payment cycle is in ' || v_days ||
        ' day(s) and no payroll run has been submitted for ' || e.name || '. Start collation.',
        '/payroll', 'payroll_cycle');
      if v_days <= st.escalation_days then
        perform app_private.notify_role_at_entity(
          'group_finance_officer', e.entity_id, v_title,
          e.name || ' has no submitted/approved payroll ' || v_days || ' day(s) before the ' ||
          to_char(v_cycle, 'DD Mon') || ' cycle.', '/payroll', 'payroll_cycle');
        perform app_private.notify_role_at_entity(
          'cfo_coo', e.entity_id, v_title,
          e.name || ' payroll is not ready for the ' || to_char(v_cycle, 'DD Mon') || ' cycle.',
          '/payroll', 'payroll_cycle');
      end if;
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;

-- Nightly jobs now include payroll cycle awareness.
create or replace function public.run_nightly_jobs()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_esc int; v_mat int; v_dep jsonb; v_part text; v_backlog int; v_payroll int;
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
  begin
    v_payroll := public.notify_payroll_cycles();
  exception when others then
    v_payroll := -1;
  end;
  v_part := app_private.ensure_audit_partition(
    (date_trunc('month', current_date) + interval '1 month')::date);

  select count(*)::int into v_backlog
  from public.message_outbox
  where status = 'queued' and created_at < now() - interval '24 hours';
  if v_backlog > 0 and not exists (
    select 1 from public.notifications
    where title = 'Message outbox backlog' and created_at > now() - interval '24 hours'
  ) then
    insert into public.notifications (user_id, role, entity_id, title, body, href)
    values (null, 'super_admin', null, 'Message outbox backlog',
            v_backlog || ' message(s) have been queued for over 24 hours. ' ||
            'Check provider keys (RESEND_API_KEY / TERMII_API_KEY) and the /api/jobs schedule.',
            '/governance');
  end if;

  return jsonb_build_object(
    'escalated_approvals', v_esc,
    'maturity_notifications', v_mat,
    'depreciation', v_dep,
    'payroll_cycle_notices', v_payroll,
    'next_audit_partition', v_part,
    'outbox_backlog', v_backlog,
    'ran_at', now());
end $$;

-- ---------------------------------------------------------------------------
-- Payment-status rollup: the campus/ministry board.
-- ---------------------------------------------------------------------------
create or replace view public.payroll_payment_status_rollup with (security_invoker = true) as
select pr.entity_id,
       e.name as entity_name,
       pr.period_year,
       pr.period_month,
       b.cycle_no,
       b.planned_date,
       b.status as batch_status,
       count(plp.id)::int as payment_count,
       count(plp.id) filter (where plp.status = 'successful')::int as successful_count,
       count(plp.id) filter (where plp.status = 'returned')::int as returned_count,
       count(plp.id) filter (where plp.status = 'contested')::int as contested_count,
       count(plp.id) filter (where plp.status in ('pending','uploaded'))::int as in_flight_count,
       coalesce(sum(plp.amount),0)::numeric(18,2) as total_amount,
       coalesce(sum(plp.amount) filter (where plp.status = 'returned'),0)::numeric(18,2) as returned_amount
from public.payroll_payment_batches b
join public.payroll_runs pr on pr.id = b.payroll_run_id
join public.entities e on e.id = pr.entity_id
left join public.payroll_line_payments plp on plp.batch_id = b.id
group by pr.entity_id, e.name, pr.period_year, pr.period_month, b.cycle_no, b.planned_date, b.status;

-- ---------------------------------------------------------------------------
-- Locks, grants, audit
-- ---------------------------------------------------------------------------
revoke all on function public.submit_payroll_run(uuid,uuid) from public, anon, authenticated;
revoke all on function public.reject_payroll_run(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.payroll_approver_role(uuid) from public, anon, authenticated;
revoke all on function public.mark_payroll_batch_uploaded(uuid,uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.refresh_payroll_batch_status(uuid) from public, anon, authenticated;
revoke all on function public.sign_payroll_batch(uuid,uuid) from public, anon, authenticated;
revoke all on function public.disburse_payroll_batch(uuid,uuid) from public, anon, authenticated;
revoke all on function public.mark_payroll_payment(uuid,public.payroll_payment_status,text,uuid) from public, anon, authenticated;
revoke all on function public.reissue_payroll_payment(uuid,uuid) from public, anon, authenticated;
revoke all on function public.create_supplementary_payroll_batch(uuid,date,uuid) from public, anon, authenticated;
revoke all on function public.notify_payroll_cycles() from public, anon, authenticated;
revoke all on function public.run_nightly_jobs() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'payroll_settings','payroll_adjustments','payroll_payment_batches',
    'payroll_line_payments','payroll_batch_signatures'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select, insert, update, delete on public.%I to hfos_app', t);
    execute format('drop policy if exists hfos_app_rw on public.%I', t);
    execute format('create policy hfos_app_rw on public.%I for all to hfos_app using (true) with check (true)', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function app_private.tg_audit()', t);
  end loop;
end $$;

drop policy if exists payroll_settings_select on public.payroll_settings;
create policy payroll_settings_select on public.payroll_settings for select to authenticated using (true);
drop policy if exists payroll_adjustments_select on public.payroll_adjustments;
create policy payroll_adjustments_select on public.payroll_adjustments for select to authenticated
  using (exists (select 1 from public.staff s where s.id = staff_id and public.user_can_access_entity(s.entity_id)));
drop policy if exists ppb_select on public.payroll_payment_batches;
create policy ppb_select on public.payroll_payment_batches for select to authenticated
  using (public.user_can_access_entity(entity_id));
drop policy if exists plp_select on public.payroll_line_payments;
create policy plp_select on public.payroll_line_payments for select to authenticated
  using (exists (select 1 from public.payroll_runs pr
                 where pr.id = payroll_run_id and public.user_can_access_entity(pr.entity_id)));
drop policy if exists pbs_select on public.payroll_batch_signatures;
create policy pbs_select on public.payroll_batch_signatures for select to authenticated using (true);

grant select on public.payroll_payment_status_rollup to authenticated, hfos_app;
