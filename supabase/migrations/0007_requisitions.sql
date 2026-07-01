-- ===========================================================================
-- Harvesters Finance OS - 0007 Requisition-to-disbursement lifecycle
-- Request -> Compilation -> Approval Chain -> Finance -> Signatures -> Ledger
-- ===========================================================================

alter type public.app_role add value if not exists 'campus_admin';
alter type public.app_role add value if not exists 'group_pastor';
alter type public.app_role add value if not exists 'global_lead_pastor';
alter type public.app_role add value if not exists 'head_of_expression';
alter type public.app_role add value if not exists 'ministry_director';
alter type public.app_role add value if not exists 'cfo_coo';
alter type public.app_role add value if not exists 'board_trustee';
alter type public.app_role add value if not exists 'finance_processor';
alter type public.app_role add value if not exists 'bank_signatory';

commit;

do $$ begin create type public.org_branch as enum
  ('congregational','special_ministry','central_office');
exception when duplicate_object then null; end $$;

do $$ begin create type public.raised_by_level as enum
  ('campus','sub_group','group','ministry_directorate','central_office','head_of_expression');
exception when duplicate_object then null; end $$;

do $$ begin create type public.requisition_status as enum
  ('draft','submitted','compiled','in_approval','approved','rejected','sent_to_finance',
   'disbursement_pending','disbursed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin create type public.requisition_batch_status as enum
  ('compiling','submitted_for_approval','fully_approved','partially_rejected');
exception when duplicate_object then null; end $$;

do $$ begin create type public.approval_status as enum
  ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

do $$ begin create type public.board_trigger_condition_type as enum
  ('amount_threshold','fund_classification','category');
exception when duplicate_object then null; end $$;

do $$ begin create type public.disbursement_status as enum
  ('pending_finance_upload','pending_signatures','fully_signed','disbursed','failed');
exception when duplicate_object then null; end $$;

do $$ begin create type public.disbursement_signature_action as enum
  ('approved','declined');
exception when duplicate_object then null; end $$;

do $$ begin create type public.disbursement_signature_method as enum
  ('in_app_confirmation','bank_platform_approval','physical_signature_logged');
exception when duplicate_object then null; end $$;

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bank_account_number_encrypted bytea not null,
  bank_account_number_last4 text,
  tax_id text,
  is_related_party boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_vendors_name_trgm on public.vendors using gin (name gin_trgm_ops);

create table if not exists public.vendor_duplicate_flags (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  possible_duplicate_vendor_id uuid not null references public.vendors(id) on delete cascade,
  score numeric(5,4) not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','dismissed','confirmed')),
  detected_at timestamptz not null default now(),
  constraint vendor_dupe_distinct check (vendor_id <> possible_duplicate_vendor_id)
);
create index if not exists idx_vendor_dupes_status on public.vendor_duplicate_flags(status);

create table if not exists public.requisition_requests (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  raised_by uuid not null references auth.users(id),
  raised_by_role public.app_role not null,
  org_branch public.org_branch not null,
  raised_by_level public.raised_by_level not null,
  vendor_id uuid references public.vendors(id) on delete restrict,
  category text not null,
  description text not null,
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null,
  needed_by_date date,
  is_urgent boolean not null default false,
  budget_line_id uuid,
  wht_applicable boolean not null default false,
  wht_rate numeric(7,4) not null default 0 check (wht_rate >= 0 and wht_rate <= 100),
  wht_withheld_amount numeric(18,2) generated always as
    (case when wht_applicable then round(amount * wht_rate / 100, 2) else 0 end) stored,
  net_payable_amount numeric(18,2) generated always as
    (amount - case when wht_applicable then round(amount * wht_rate / 100, 2) else 0 end) stored,
  status public.requisition_status not null default 'submitted',
  rejection_reason text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz not null default now()
);
create index if not exists idx_req_entity_status on public.requisition_requests(entity_id, status);
create index if not exists idx_req_raiser on public.requisition_requests(raised_by);
create index if not exists idx_req_urgent on public.requisition_requests(is_urgent desc, needed_by_date);

create table if not exists public.requisition_batches (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  compiled_by uuid not null references auth.users(id),
  batch_date date not null default current_date,
  total_amount numeric(18,2) not null default 0,
  currency char(3) not null default 'NGN',
  status public.requisition_batch_status not null default 'compiling',
  org_branch public.org_branch not null,
  raised_by_level public.raised_by_level not null,
  rejection_reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_batches_entity_status on public.requisition_batches(entity_id, status);

create table if not exists public.requisition_batch_items (
  batch_id uuid not null references public.requisition_batches(id) on delete cascade,
  requisition_request_id uuid not null references public.requisition_requests(id) on delete restrict,
  primary key (batch_id, requisition_request_id),
  unique (requisition_request_id)
);

create table if not exists public.approval_chain_templates (
  id uuid primary key default gen_random_uuid(),
  org_branch public.org_branch not null,
  raised_by_level public.raised_by_level not null,
  sequence_order int not null check (sequence_order > 0),
  required_approver_role public.app_role not null,
  amount_threshold_min numeric(18,2),
  amount_threshold_max numeric(18,2),
  requires_board boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_branch, raised_by_level, sequence_order, required_approver_role)
);

create table if not exists public.board_approval_triggers (
  id uuid primary key default gen_random_uuid(),
  condition_type public.board_trigger_condition_type not null,
  amount_threshold numeric(18,2),
  fund_classification public.fund_classification,
  category text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint board_trigger_has_value check (
    (condition_type = 'amount_threshold' and amount_threshold is not null)
    or (condition_type = 'fund_classification' and fund_classification is not null)
    or (condition_type = 'category' and category is not null)
  )
);
create unique index if not exists board_trigger_amount_uniq
  on public.board_approval_triggers(amount_threshold)
  where condition_type = 'amount_threshold';
create unique index if not exists board_trigger_category_uniq
  on public.board_approval_triggers(lower(category))
  where condition_type = 'category';

create table if not exists public.requisition_approvals (
  id uuid primary key default gen_random_uuid(),
  requisition_batch_id uuid references public.requisition_batches(id) on delete cascade,
  requisition_request_id uuid references public.requisition_requests(id) on delete cascade,
  approver_role public.app_role not null,
  approver_user_id uuid references auth.users(id),
  sequence_order int not null check (sequence_order > 0),
  status public.approval_status not null default 'pending',
  decided_at timestamptz,
  comments text,
  notified_at timestamptz,
  is_board_step boolean not null default false,
  constraint approval_one_subject check (
    (requisition_batch_id is not null and requisition_request_id is null)
    or (requisition_batch_id is null and requisition_request_id is not null)
  )
);
create index if not exists idx_approvals_batch on public.requisition_approvals(requisition_batch_id);
create index if not exists idx_approvals_request on public.requisition_approvals(requisition_request_id);
create index if not exists idx_approvals_role_status on public.requisition_approvals(approver_role, status);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  role public.app_role,
  entity_id uuid references public.entities(id) on delete cascade,
  title text not null,
  body text not null,
  href text,
  is_read boolean not null default false,
  email_hook_payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on public.notifications(user_id, is_read, created_at desc);
create index if not exists idx_notifications_role on public.notifications(role, is_read, created_at desc);

create table if not exists public.disbursement_signature_slots (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  slot_label text not null,
  slot_order int not null default 1,
  requires_all_members boolean not null default false,
  created_at timestamptz not null default now(),
  unique (bank_account_id, slot_label)
);

create table if not exists public.disbursement_signature_slot_members (
  slot_id uuid not null references public.disbursement_signature_slots(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (slot_id, user_id)
);

create table if not exists public.disbursement_records (
  id uuid primary key default gen_random_uuid(),
  requisition_batch_id uuid references public.requisition_batches(id) on delete restrict,
  requisition_request_id uuid references public.requisition_requests(id) on delete restrict,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  finance_processed_by uuid references auth.users(id),
  bank_upload_reference text,
  transfer_instruction_reference text,
  gross_amount numeric(18,2) not null,
  wht_withheld_amount numeric(18,2) not null default 0,
  net_payable_amount numeric(18,2) not null,
  disbursement_status public.disbursement_status not null default 'pending_finance_upload',
  journal_entry_id uuid references public.journal_entries(id) on delete restrict,
  created_at timestamptz not null default now(),
  disbursed_at timestamptz,
  constraint disb_one_subject check (
    (requisition_batch_id is not null and requisition_request_id is null)
    or (requisition_batch_id is null and requisition_request_id is not null)
  )
);
create index if not exists idx_disb_status on public.disbursement_records(disbursement_status);

create table if not exists public.disbursement_signatures (
  disbursement_record_id uuid not null references public.disbursement_records(id) on delete cascade,
  slot_id uuid not null references public.disbursement_signature_slots(id) on delete restrict,
  signatory_user_id uuid not null references auth.users(id),
  action public.disbursement_signature_action not null,
  signed_at timestamptz not null default now(),
  method public.disbursement_signature_method not null,
  primary key (disbursement_record_id, slot_id, signatory_user_id)
);

create table if not exists public.wht_remittance_log (
  id uuid primary key default gen_random_uuid(),
  requisition_request_id uuid not null references public.requisition_requests(id) on delete restrict,
  disbursement_record_id uuid references public.disbursement_records(id) on delete restrict,
  entity_id uuid not null references public.entities(id) on delete restrict,
  entity_state text,
  remittance_month date not null,
  withheld_amount numeric(18,2) not null,
  remitted_amount numeric(18,2) not null default 0,
  status text not null default 'owed' check (status in ('owed','partially_remitted','remitted')),
  created_at timestamptz not null default now(),
  remitted_at timestamptz
);

create or replace function public.create_vendor(
  p_name text, p_bank_account_number text, p_tax_id text default null, p_is_related_party boolean default false
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_last4 text;
begin
  v_last4 := right(regexp_replace(coalesce(p_bank_account_number, ''), '\D', '', 'g'), 4);
  insert into public.vendors (name, bank_account_number_encrypted, bank_account_number_last4, tax_id, is_related_party)
  values (p_name, public.encrypt_account_number(p_bank_account_number), v_last4, p_tax_id, p_is_related_party)
  returning id into v_id;

  insert into public.vendor_duplicate_flags (vendor_id, possible_duplicate_vendor_id, score, reason)
  select v_id, v.id,
         greatest(similarity(lower(p_name), lower(v.name)),
                  case when v.bank_account_number_last4 = v_last4 then 0.85 else 0 end),
         concat_ws(' + ',
           case when similarity(lower(p_name), lower(v.name)) >= 0.55 then 'similar name' end,
           case when v.bank_account_number_last4 = v_last4 then 'same bank account last 4' end)
  from public.vendors v
  where v.id <> v_id
    and (similarity(lower(p_name), lower(v.name)) >= 0.55 or v.bank_account_number_last4 = v_last4);
  return v_id;
end $$;
revoke all on function public.create_vendor(text,text,text,boolean) from public, anon, authenticated;

create or replace function app_private.subject_total(p_batch uuid, p_request uuid)
returns numeric language sql stable set search_path = '' as $$
  select coalesce(
    (select total_amount from public.requisition_batches where id = p_batch),
    (select amount from public.requisition_requests where id = p_request),
    0
  );
$$;

create or replace function public.generate_requisition_approvals(p_batch uuid default null, p_request uuid default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_branch public.org_branch; v_level public.raised_by_level; v_amount numeric; v_category text; v_max int; v_board boolean;
begin
  if (p_batch is null) = (p_request is null) then
    raise exception 'Provide exactly one batch or request' using errcode = 'check_violation';
  end if;

  if p_batch is not null then
    select org_branch, raised_by_level, total_amount into v_branch, v_level, v_amount
    from public.requisition_batches where id = p_batch;
    select string_agg(distinct rr.category, ', ') into v_category
    from public.requisition_batch_items bi join public.requisition_requests rr on rr.id = bi.requisition_request_id
    where bi.batch_id = p_batch;
  else
    select org_branch, raised_by_level, amount, category into v_branch, v_level, v_amount, v_category
    from public.requisition_requests where id = p_request;
  end if;

  insert into public.requisition_approvals
    (requisition_batch_id, requisition_request_id, approver_role, sequence_order, notified_at)
  select p_batch, p_request, required_approver_role, sequence_order,
         case when sequence_order = 1 then now() end
  from public.approval_chain_templates
  where org_branch = v_branch and raised_by_level = v_level
    and (amount_threshold_min is null or v_amount >= amount_threshold_min)
    and (amount_threshold_max is null or v_amount <= amount_threshold_max)
  order by sequence_order;

  select coalesce(max(sequence_order), 0) into v_max
  from public.requisition_approvals
  where requisition_batch_id is not distinct from p_batch
    and requisition_request_id is not distinct from p_request;

  select exists (
    select 1 from public.board_approval_triggers t
    where t.is_active and (
      (t.condition_type = 'amount_threshold' and v_amount >= t.amount_threshold)
      or (t.condition_type = 'category' and v_category ilike '%' || t.category || '%')
    )
  ) into v_board;

  if v_board then
    insert into public.requisition_approvals
      (requisition_batch_id, requisition_request_id, approver_role, sequence_order, is_board_step)
    values (p_batch, p_request, 'board_trustee', v_max + 1, true);
  end if;

  if p_batch is not null then
    update public.requisition_batches set status = 'submitted_for_approval' where id = p_batch;
    update public.requisition_requests rr set status = 'in_approval'
    from public.requisition_batch_items bi where bi.batch_id = p_batch and rr.id = bi.requisition_request_id;
  else
    update public.requisition_requests set status = 'in_approval' where id = p_request;
  end if;
end $$;
revoke all on function public.generate_requisition_approvals(uuid,uuid) from public, anon, authenticated;

create or replace function public.decide_requisition_approval(
  p_approval_id uuid, p_actor uuid, p_decision public.approval_status, p_comments text default null
) returns void language plpgsql volatile security definer set search_path = '' as $$
declare a public.requisition_approvals; v_raiser uuid; v_subject_approved boolean;
begin
  select * into a from public.requisition_approvals where id = p_approval_id for update;
  if not found or a.status <> 'pending' then raise exception 'Approval step is not pending' using errcode = 'check_violation'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected' using errcode = 'check_violation'; end if;
  if exists (
    select 1 from public.requisition_approvals prev
    where prev.sequence_order < a.sequence_order
      and prev.requisition_batch_id is not distinct from a.requisition_batch_id
      and prev.requisition_request_id is not distinct from a.requisition_request_id
      and prev.status <> 'approved'
  ) then raise exception 'Prior approval steps are not complete' using errcode = 'check_violation'; end if;

  select raised_by into v_raiser
  from public.requisition_requests
  where id = coalesce(a.requisition_request_id, (
    select requisition_request_id from public.requisition_batch_items where batch_id = a.requisition_batch_id limit 1
  ));
  if v_raiser = p_actor then raise exception 'Segregation of duties: request raiser cannot approve this requisition' using errcode = 'check_violation'; end if;

  update public.requisition_approvals
     set status = p_decision, approver_user_id = p_actor, decided_at = now(), comments = p_comments
   where id = p_approval_id;

  if p_decision = 'rejected' then
    if a.requisition_batch_id is not null then
      update public.requisition_batches set status = 'partially_rejected', rejection_reason = p_comments where id = a.requisition_batch_id;
      update public.requisition_requests rr set status = 'rejected', rejection_reason = p_comments
      from public.requisition_batch_items bi where bi.batch_id = a.requisition_batch_id and rr.id = bi.requisition_request_id;
    else
      update public.requisition_requests set status = 'rejected', rejection_reason = p_comments where id = a.requisition_request_id;
    end if;
    return;
  end if;

  update public.requisition_approvals next
     set notified_at = coalesce(notified_at, now())
   where next.sequence_order = a.sequence_order + 1
     and next.requisition_batch_id is not distinct from a.requisition_batch_id
     and next.requisition_request_id is not distinct from a.requisition_request_id;

  select not exists (
    select 1 from public.requisition_approvals x
    where x.requisition_batch_id is not distinct from a.requisition_batch_id
      and x.requisition_request_id is not distinct from a.requisition_request_id
      and x.status <> 'approved'
  ) into v_subject_approved;

  if v_subject_approved then
    if a.requisition_batch_id is not null then
      update public.requisition_batches set status = 'fully_approved' where id = a.requisition_batch_id;
      update public.requisition_requests rr set status = 'approved'
      from public.requisition_batch_items bi where bi.batch_id = a.requisition_batch_id and rr.id = bi.requisition_request_id;
    else
      update public.requisition_requests set status = 'approved' where id = a.requisition_request_id;
    end if;
  end if;
end $$;
revoke all on function public.decide_requisition_approval(uuid,uuid,public.approval_status,text) from public, anon, authenticated;

create or replace function public.refresh_disbursement_status(p_disbursement_id uuid)
returns public.disbursement_status language plpgsql volatile security definer set search_path = '' as $$
declare v_missing int; v_status public.disbursement_status;
begin
  select count(*) into v_missing
  from public.disbursement_signature_slots slot
  join public.disbursement_records dr on dr.bank_account_id = slot.bank_account_id and dr.id = p_disbursement_id
  where not (
    (slot.requires_all_members and not exists (
      select 1 from public.disbursement_signature_slot_members m
      where m.slot_id = slot.id and not exists (
        select 1 from public.disbursement_signatures s
        where s.disbursement_record_id = p_disbursement_id and s.slot_id = slot.id
          and s.signatory_user_id = m.user_id and s.action = 'approved'
      )
    ))
    or (not slot.requires_all_members and exists (
      select 1 from public.disbursement_signatures s
      where s.disbursement_record_id = p_disbursement_id and s.slot_id = slot.id and s.action = 'approved'
    ))
  );

  v_status := case when v_missing = 0 then 'fully_signed' else 'pending_signatures' end;
  update public.disbursement_records
     set disbursement_status = v_status
   where id = p_disbursement_id and disbursement_status in ('pending_signatures','fully_signed');
  return v_status;
end $$;
revoke all on function public.refresh_disbursement_status(uuid) from public, anon, authenticated;

create or replace function public.mark_disbursement_disbursed(p_disbursement_id uuid, p_actor uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare d public.disbursement_records; v_entity uuid; v_currency text; v_expense uuid; v_bank uuid; v_fund public.fund_classification; v_je uuid;
begin
  select * into d from public.disbursement_records where id = p_disbursement_id for update;
  if not found or d.disbursement_status <> 'fully_signed' then raise exception 'Disbursement is not fully signed' using errcode = 'check_violation'; end if;
  select coalesce(rr.entity_id, rb.entity_id), coalesce(rr.currency, rb.currency)
    into v_entity, v_currency
  from public.disbursement_records dr
  left join public.requisition_requests rr on rr.id = dr.requisition_request_id
  left join public.requisition_batches rb on rb.id = dr.requisition_batch_id
  where dr.id = p_disbursement_id;
  select id, fund_classification into v_expense, v_fund from public.accounts where account_type = 'expense' order by code limit 1;
  select id into v_bank from public.accounts where code = '1010';

  insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
  values (v_entity, current_date, 'Disbursement ' || d.id::text, 'expense', p_actor, 'draft') returning id into v_je;
  insert into public.journal_entry_lines (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
  values (v_je, v_expense, v_entity, d.net_payable_amount, 0, v_fund, v_currency),
         (v_je, v_bank, v_entity, 0, d.net_payable_amount, v_fund, v_currency);
  update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_je;

  update public.disbursement_records
     set disbursement_status = 'disbursed', journal_entry_id = v_je, disbursed_at = now()
   where id = p_disbursement_id;
  update public.requisition_requests set status = 'disbursed'
  where id = d.requisition_request_id or id in (select requisition_request_id from public.requisition_batch_items where batch_id = d.requisition_batch_id);
  return v_je;
end $$;
revoke all on function public.mark_disbursement_disbursed(uuid,uuid) from public, anon, authenticated;

insert into public.approval_chain_templates
  (org_branch, raised_by_level, sequence_order, required_approver_role, amount_threshold_min, amount_threshold_max)
values
  ('congregational','campus',1,'campus_pastor',null,null),
  ('congregational','campus',2,'sub_group_pastor',null,null),
  ('congregational','campus',3,'group_pastor',1000000,null),
  ('congregational','campus',4,'global_lead_pastor',5000000,null),
  ('special_ministry','ministry_directorate',1,'ministry_lead',null,null),
  ('special_ministry','ministry_directorate',2,'global_lead_pastor',null,null),
  ('central_office','head_of_expression',1,'head_of_expression',null,null),
  ('central_office','head_of_expression',2,'ministry_director',null,null),
  ('central_office','head_of_expression',3,'cfo_coo',null,null),
  ('central_office','head_of_expression',4,'global_lead_pastor',5000000,null)
on conflict do nothing;

insert into public.board_approval_triggers (condition_type, amount_threshold)
values ('amount_threshold', 25000000) on conflict do nothing;
insert into public.board_approval_triggers (condition_type, category)
values ('category', 'capital expenditure'), ('category', 'building fund') on conflict do nothing;

do $$
declare t text;
begin
  foreach t in array array[
    'vendors','vendor_duplicate_flags','requisition_requests','requisition_batches',
    'requisition_batch_items','approval_chain_templates','board_approval_triggers',
    'requisition_approvals','notifications','disbursement_signature_slots',
    'disbursement_signature_slot_members','disbursement_records',
    'disbursement_signatures','wht_remittance_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function app_private.tg_audit()', t);
  end loop;
end $$;

drop policy if exists requisitions_select on public.requisition_requests;
create policy requisitions_select on public.requisition_requests for select to authenticated
  using (public.user_can_access_entity(entity_id) or raised_by = auth.uid());
drop policy if exists batches_select on public.requisition_batches;
create policy batches_select on public.requisition_batches for select to authenticated
  using (public.user_can_access_entity(entity_id));
drop policy if exists wht_select on public.wht_remittance_log;
create policy wht_select on public.wht_remittance_log for select to authenticated
  using (public.user_can_access_entity(entity_id));
drop policy if exists vendors_select on public.vendors;
create policy vendors_select on public.vendors for select to authenticated using (true);
drop policy if exists vendor_dupes_select on public.vendor_duplicate_flags;
create policy vendor_dupes_select on public.vendor_duplicate_flags for select to authenticated using (public.is_super_admin());
drop policy if exists approval_templates_select on public.approval_chain_templates;
create policy approval_templates_select on public.approval_chain_templates for select to authenticated using (true);
drop policy if exists board_triggers_select on public.board_approval_triggers;
create policy board_triggers_select on public.board_approval_triggers for select to authenticated using (true);
drop policy if exists approvals_select on public.requisition_approvals;
create policy approvals_select on public.requisition_approvals for select to authenticated using (true);
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());
drop policy if exists disb_slots_select on public.disbursement_signature_slots;
create policy disb_slots_select on public.disbursement_signature_slots for select to authenticated using (true);
drop policy if exists disb_slot_members_select on public.disbursement_signature_slot_members;
create policy disb_slot_members_select on public.disbursement_signature_slot_members for select to authenticated using (true);
drop policy if exists disb_records_select on public.disbursement_records;
create policy disb_records_select on public.disbursement_records for select to authenticated using (true);
drop policy if exists disb_signatures_select on public.disbursement_signatures;
create policy disb_signatures_select on public.disbursement_signatures for select to authenticated using (true);
