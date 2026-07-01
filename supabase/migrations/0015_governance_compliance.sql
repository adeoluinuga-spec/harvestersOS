-- ===========================================================================
-- Harvesters Finance OS - 0015 Compliance and governance reporting
-- Regulatory flags, SCUML/WHT dashboards, related-party governance,
-- whistleblower privacy, and audit-log reporting helpers.
-- ===========================================================================

alter type public.app_role add value if not exists 'governance_officer';

commit;

do $$ begin create type public.scuml_status as enum
  ('not_required','pending_registration','registered','filing_due','filed','overdue');
exception when duplicate_object then null; end $$;

do $$ begin create type public.whistleblower_status as enum
  ('submitted','under_review','resolved');
exception when duplicate_object then null; end $$;

do $$ begin create type public.whistleblower_category as enum
  ('fraud','harassment','financial_misconduct','safeguarding','conflict_of_interest','other');
exception when duplicate_object then null; end $$;

create or replace function public.is_governance_reader(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_entity_roles
    where user_id = uid
      and role in ('super_admin','auditor','governance_officer','board_trustee')
  );
$$;
grant execute on function public.is_governance_reader(uuid) to authenticated, service_role;

create table if not exists public.compliance_settings (
  entity_id uuid primary key references public.entities(id) on delete cascade,
  nfiu_cash_threshold numeric(18,2) not null default 5000000 check (nfiu_cash_threshold > 0),
  wht_overdue_days int not null default 30 check (wht_overdue_days >= 1),
  updated_at timestamptz not null default now()
);

create table if not exists public.scuml_compliance_log (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  registration_status public.scuml_status not null default 'pending_registration',
  registration_number text,
  registration_date date,
  last_filing_date date,
  next_filing_due_date date,
  notes text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_scuml_entity on public.scuml_compliance_log(entity_id, registration_status);

alter table public.requisition_requests
  add column if not exists related_party_disclosure_note text;

create table if not exists public.related_party_disclosures (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  requisition_request_id uuid references public.requisition_requests(id) on delete restrict,
  entity_id uuid references public.entities(id) on delete restrict,
  disclosure_note text not null,
  status text not null default 'open' check (status in ('open','reviewed','closed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_related_party_vendor_status on public.related_party_disclosures(vendor_id, status);
create unique index if not exists related_party_req_once
  on public.related_party_disclosures(requisition_request_id)
  where requisition_request_id is not null;

create table if not exists public.conflict_of_interest_registry (
  id uuid primary key default gen_random_uuid(),
  trustee_id uuid references auth.users(id) on delete restrict,
  staff_id uuid references public.staff(id) on delete restrict,
  declared_interest text not null,
  date_declared date not null default current_date,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  status text not null default 'declared' check (status in ('declared','reviewed','mitigated','closed')),
  created_at timestamptz not null default now(),
  constraint coi_subject_required check (trustee_id is not null or staff_id is not null)
);

create table if not exists public.whistleblower_reports (
  id uuid primary key default gen_random_uuid(),
  is_anonymous boolean not null default true,
  reporter_user_id uuid references auth.users(id) on delete set null,
  reporter_contact text,
  category public.whistleblower_category not null,
  description text not null,
  status public.whistleblower_status not null default 'submitted',
  received_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  resolution_note text,
  constraint whistleblower_identity_check check (
    is_anonymous
    or reporter_user_id is not null
    or nullif(trim(coalesce(reporter_contact, '')), '') is not null
  )
);

create or replace function app_private.tg_related_party_requisition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_related boolean;
begin
  if new.vendor_id is null then
    return new;
  end if;

  select is_related_party into v_related
  from public.vendors
  where id = new.vendor_id;

  if v_related then
    if length(trim(coalesce(new.related_party_disclosure_note, ''))) < 10 then
      raise exception 'Related-party requisitions require a disclosure note'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_related_party_requisition on public.requisition_requests;
create trigger trg_related_party_requisition
  before insert or update of vendor_id, related_party_disclosure_note on public.requisition_requests
  for each row execute function app_private.tg_related_party_requisition();

create or replace function app_private.tg_related_party_disclosure_register()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_related boolean;
begin
  if new.vendor_id is null then
    return new;
  end if;
  select is_related_party into v_related from public.vendors where id = new.vendor_id;
  if v_related then
    insert into public.related_party_disclosures
      (vendor_id, requisition_request_id, entity_id, disclosure_note)
    values
      (new.vendor_id, new.id, new.entity_id, new.related_party_disclosure_note)
    on conflict (requisition_request_id) where requisition_request_id is not null
    do update set disclosure_note = excluded.disclosure_note, entity_id = excluded.entity_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_related_party_disclosure_register on public.requisition_requests;
create trigger trg_related_party_disclosure_register
  after insert or update of vendor_id, related_party_disclosure_note on public.requisition_requests
  for each row execute function app_private.tg_related_party_disclosure_register();

create or replace function public.generate_requisition_approvals(p_batch uuid default null, p_request uuid default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_branch public.org_branch; v_level public.raised_by_level; v_amount numeric; v_category text;
  v_max int; v_board boolean; v_related_party boolean;
begin
  if (p_batch is null) = (p_request is null) then
    raise exception 'Provide exactly one batch or request' using errcode = 'check_violation';
  end if;

  if p_batch is not null then
    select org_branch, raised_by_level, total_amount into v_branch, v_level, v_amount
    from public.requisition_batches where id = p_batch;
    select string_agg(distinct rr.category, ', '),
           bool_or(coalesce(v.is_related_party, false))
      into v_category, v_related_party
    from public.requisition_batch_items bi
    join public.requisition_requests rr on rr.id = bi.requisition_request_id
    left join public.vendors v on v.id = rr.vendor_id
    where bi.batch_id = p_batch;
  else
    select rr.org_branch, rr.raised_by_level, rr.amount, rr.category,
           coalesce(v.is_related_party, false)
      into v_branch, v_level, v_amount, v_category, v_related_party
    from public.requisition_requests rr
    left join public.vendors v on v.id = rr.vendor_id
    where rr.id = p_request;
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

  if coalesce(v_related_party, false) then
    insert into public.requisition_approvals
      (requisition_batch_id, requisition_request_id, approver_role, sequence_order, is_board_step)
    values
      (p_batch, p_request, 'cfo_coo', v_max + 1, true),
      (p_batch, p_request, 'board_trustee', v_max + 2, true)
    on conflict do nothing;
  end if;

  select exists (
    select 1 from public.board_approval_triggers t
    where t.is_active and (
      (t.condition_type = 'amount_threshold' and v_amount >= t.amount_threshold)
      or (t.condition_type = 'category' and v_category ilike '%' || t.category || '%')
    )
  ) into v_board;

  if v_board and not coalesce(v_related_party, false) then
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

create or replace view public.nfiu_flagged_transactions with (security_invoker = true) as
select 'giving'::text as transaction_type,
       gr.id as source_id,
       gr.recording_entity_id as entity_id,
       e.name as entity_name,
       gr.transaction_date,
       coalesce(g.full_name, 'Anonymous') as counterparty,
       gt.name as description,
       gr.amount,
       gr.currency,
       coalesce(cs.nfiu_cash_threshold, 5000000) as threshold_amount
from public.giving_records gr
join public.entities e on e.id = gr.recording_entity_id
join public.giving_types gt on gt.id = gr.giving_type_id
left join public.givers g on g.id = gr.giver_id
left join public.compliance_settings cs on cs.entity_id = gr.recording_entity_id
where gr.channel = 'cash'
  and gr.amount >= coalesce(cs.nfiu_cash_threshold, 5000000)
union all
select 'expense_cash'::text,
       je.id,
       je.entity_id,
       e.name,
       je.transaction_date,
       null::text,
       je.description,
       jel.credit_amount,
       jel.currency,
       coalesce(cs.nfiu_cash_threshold, 5000000)
from public.journal_entry_lines jel
join public.journal_entries je on je.id = jel.journal_entry_id
join public.entities e on e.id = je.entity_id
join public.accounts a on a.id = jel.account_id
left join public.compliance_settings cs on cs.entity_id = je.entity_id
where je.status = 'posted'
  and a.code = '1000'
  and jel.credit_amount >= coalesce(cs.nfiu_cash_threshold, 5000000);

create or replace view public.wht_remittance_dashboard with (security_invoker = true) as
select w.entity_id,
       e.name as entity_name,
       w.remittance_month,
       w.entity_state,
       sum(w.withheld_amount) as withheld_amount,
       sum(w.remitted_amount) as remitted_amount,
       sum(w.withheld_amount - w.remitted_amount) as outstanding_amount,
       min(w.status) as status,
       (current_date > (w.remittance_month + (coalesce(cs.wht_overdue_days, 30) || ' days')::interval)::date
        and sum(w.withheld_amount - w.remitted_amount) > 0) as is_overdue
from public.wht_remittance_log w
join public.entities e on e.id = w.entity_id
left join public.compliance_settings cs on cs.entity_id = w.entity_id
group by w.entity_id, e.name, w.remittance_month, w.entity_state, cs.wht_overdue_days;

do $$
declare t text;
begin
  foreach t in array array[
    'compliance_settings','scuml_compliance_log','related_party_disclosures',
    'conflict_of_interest_registry','whistleblower_reports'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function app_private.tg_audit()', t);
  end loop;
end $$;

grant select on public.nfiu_flagged_transactions, public.wht_remittance_dashboard to authenticated;

drop policy if exists compliance_settings_select on public.compliance_settings;
create policy compliance_settings_select on public.compliance_settings for select to authenticated
  using (public.user_can_access_entity(entity_id));

drop policy if exists scuml_select on public.scuml_compliance_log;
create policy scuml_select on public.scuml_compliance_log for select to authenticated
  using (public.user_can_access_entity(entity_id) and public.is_governance_reader());

drop policy if exists related_party_select on public.related_party_disclosures;
create policy related_party_select on public.related_party_disclosures for select to authenticated
  using (public.is_governance_reader() and (entity_id is null or public.user_can_access_entity(entity_id)));

drop policy if exists coi_select on public.conflict_of_interest_registry;
create policy coi_select on public.conflict_of_interest_registry for select to authenticated
  using (public.is_governance_reader());

drop policy if exists whistleblower_select on public.whistleblower_reports;
create policy whistleblower_select on public.whistleblower_reports for select to authenticated
  using (public.is_governance_reader());
