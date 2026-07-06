-- ===========================================================================
-- Harvesters Finance OS — 0032 WHT liability, intercompany, tie-out controls
--
-- Three accounting-correctness upgrades:
--
-- 1. WHT PAYABLE IN THE LEDGER. Until now a disbursement posted
--    debit Expense (net) / credit Bank (net) — the tax withheld from the
--    vendor never existed in the GL, only in a side log. Correct posting:
--       debit Expense (GROSS) / credit Bank (net) / credit WHT Payable (withheld)
--    so the balance sheet carries the liability until it is remitted, and
--    remittance clears it (credit Bank / debit WHT Payable).
--
-- 2. INTERCOMPANY ACCOUNTS + CROSS-BORDER POSTING. Approved cross-border
--    transfers now post real, linked entries through Due-From/Due-To
--    intercompany accounts — and consolidation emits ELIMINATION rows for
--    those accounts so group totals never double-count internal money moves.
--
-- 3. TIE-OUT CONTROL VIEW. Continuous sub-ledger ↔ GL reconciliation:
--    WHT remittance log vs the WHT Payable account, intercompany due-from vs
--    due-to. Surfaced under Governance.
-- ===========================================================================

-- --- Accounts ----------------------------------------------------------------
insert into public.accounts (code, name, account_type, fund_classification)
select v.code, v.name, v.t::public.account_type, 'unrestricted'
from (values
  ('1900','Due from Related Entities','asset'),
  ('2200','WHT Payable','liability'),
  ('2900','Due to Related Entities','liability')
) as v(code, name, t)
where not exists (select 1 from public.accounts a where a.code = v.code);

-- --- 1. Disbursement posting: gross expense + WHT liability --------------------
create or replace function public.mark_disbursement_disbursed(p_disbursement_id uuid, p_actor uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  d public.disbursement_records;
  v_entity uuid; v_currency text; v_expense uuid; v_bank uuid; v_wht_acct uuid;
  v_fund public.fund_classification; v_je uuid;
begin
  select * into d from public.disbursement_records where id = p_disbursement_id for update;
  if not found or d.disbursement_status <> 'fully_signed' then
    raise exception 'Disbursement is not fully signed' using errcode = 'check_violation';
  end if;
  select coalesce(rr.entity_id, rb.entity_id), coalesce(rr.currency, rb.currency)
    into v_entity, v_currency
  from public.disbursement_records dr
  left join public.requisition_requests rr on rr.id = dr.requisition_request_id
  left join public.requisition_batches rb on rb.id = dr.requisition_batch_id
  where dr.id = p_disbursement_id;
  select id, fund_classification into v_expense, v_fund
    from public.accounts where account_type = 'expense' order by code limit 1;
  select id into v_bank from public.accounts where code = '1010';
  select id into v_wht_acct from public.accounts where code = '2200';

  insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
  values (v_entity, current_date, 'Disbursement ' || d.id::text, 'expense', p_actor, 'draft')
  returning id into v_je;

  -- Gross expense; net leaves the bank; the withheld tax becomes a liability.
  insert into public.journal_entry_lines
    (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
  values (v_je, v_expense, v_entity, d.gross_amount, 0, v_fund, v_currency),
         (v_je, v_bank, v_entity, 0, d.net_payable_amount, v_fund, v_currency);
  if coalesce(d.wht_withheld_amount, 0) > 0 then
    insert into public.journal_entry_lines
      (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
    values (v_je, v_wht_acct, v_entity, 0, d.wht_withheld_amount, v_fund, v_currency);
  end if;
  update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_je;

  update public.disbursement_records
     set disbursement_status = 'disbursed', journal_entry_id = v_je, disbursed_at = now()
   where id = p_disbursement_id;
  update public.requisition_requests set status = 'disbursed'
  where id = d.requisition_request_id
     or id in (select requisition_request_id from public.requisition_batch_items where batch_id = d.requisition_batch_id);
  return v_je;
end $$;
revoke all on function public.mark_disbursement_disbursed(uuid,uuid) from public, anon, authenticated;

-- WHT remittance now clears the liability through the ledger.
create or replace function public.post_wht_remittance(
  p_entity_id uuid, p_amount numeric, p_remittance_date date default current_date, p_actor uuid default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_je uuid; v_bank uuid; v_wht uuid; v_currency char(3); v_fund public.fund_classification := 'unrestricted';
begin
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Remittance amount must be positive' using errcode = 'check_violation';
  end if;
  select functional_currency into v_currency from public.entities where id = p_entity_id;
  select id into v_bank from public.accounts where code = '1010';
  select id into v_wht from public.accounts where code = '2200';

  insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
  values (p_entity_id, p_remittance_date, 'WHT remittance to FIRS/State IRS', 'expense', p_actor, 'draft')
  returning id into v_je;
  insert into public.journal_entry_lines
    (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
  values (v_je, v_wht, p_entity_id, p_amount, 0, v_fund, v_currency),
         (v_je, v_bank, p_entity_id, 0, p_amount, v_fund, v_currency);
  update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_je;
  return v_je;
end $$;
revoke all on function public.post_wht_remittance(uuid,numeric,date,uuid) from public, anon, authenticated;

-- --- 2. Cross-border transfers post through intercompany accounts ---------------
alter table public.cross_border_transfers
  add column if not exists sending_journal_entry_id uuid references public.journal_entries(id),
  add column if not exists receiving_journal_entry_id uuid references public.journal_entries(id);

create or replace function public.post_cross_border_transfer(p_transfer_id uuid, p_actor uuid default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.cross_border_transfers;
  v_bank uuid; v_due_from uuid; v_due_to uuid;
  v_send_ccy char(3); v_recv_ccy char(3);
  v_je_s uuid; v_je_r uuid;
  v_rate_recv numeric;
begin
  select * into t from public.cross_border_transfers where id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found' using errcode = 'check_violation'; end if;
  if t.sending_journal_entry_id is not null then return; end if;        -- idempotent
  if t.compliance_status <> 'documented' then
    raise exception 'Transfer must be documented before posting' using errcode = 'check_violation';
  end if;

  select functional_currency into v_send_ccy from public.entities where id = t.sending_entity_id;
  select functional_currency into v_recv_ccy from public.entities where id = t.receiving_entity_id;
  select id into v_bank from public.accounts where code = '1010';
  select id into v_due_from from public.accounts where code = '1900';
  select id into v_due_to from public.accounts where code = '2900';

  -- Sender: money leaves the bank, a related-entity receivable arises.
  insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
  values (t.sending_entity_id, current_date,
          'Cross-border transfer to related entity (' || t.purpose || ')', 'transfer', p_actor, 'draft')
  returning id into v_je_s;
  insert into public.journal_entry_lines
    (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
  values (v_je_s, v_due_from, t.sending_entity_id, t.amount, 0, 'unrestricted', t.currency),
         (v_je_s, v_bank, t.sending_entity_id, 0, t.amount, 'unrestricted', t.currency);
  update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_je_s;

  -- Receiver: money arrives, mirrored as a related-entity payable.
  insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
  values (t.receiving_entity_id, current_date,
          'Cross-border transfer from related entity (' || t.purpose || ')', 'transfer', p_actor, 'draft')
  returning id into v_je_r;
  insert into public.journal_entry_lines
    (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
  values (v_je_r, v_bank, t.receiving_entity_id, t.amount, 0, 'unrestricted', t.currency),
         (v_je_r, v_due_to, t.receiving_entity_id, 0, t.amount, 'unrestricted', t.currency);
  update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_je_r;

  update public.cross_border_transfers
     set sending_journal_entry_id = v_je_s, receiving_journal_entry_id = v_je_r
   where id = p_transfer_id;
end $$;
revoke all on function public.post_cross_border_transfer(uuid, uuid) from public, anon, authenticated;

-- --- Consolidation: emit elimination rows for intercompany accounts -------------
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
      and not (je.source_module = 'closing' and a.account_type in ('income','expense'))
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
  -- Intercompany Due-From/Due-To cancel at group level: emit equal-and-
  -- opposite elimination rows so consolidated sums exclude internal moves.
  eliminations as (
    select 'elimination'::text as row_type,
           entity_id,
           entity_name,
           account_id,
           account_code,
           account_name,
           account_type,
           functional_currency,
           -historical_debit_ngn as historical_debit_ngn,
           -historical_credit_ngn as historical_credit_ngn,
           -net_historical_ngn as net_historical_ngn,
           null::numeric, null::numeric
    from actuals
    where account_code in ('1900','2900')
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
  select * from eliminations
  union all
  select * from cta;
$$;

-- --- 3. Tie-out control view -----------------------------------------------------
create or replace view public.control_tieouts with (security_invoker = true) as
with gl as (
  select a.code,
         sum(round((jel.credit_amount - jel.debit_amount) * jel.fx_rate_to_presentation_currency, 2)) as credit_balance_ngn,
         sum(round((jel.debit_amount - jel.credit_amount) * jel.fx_rate_to_presentation_currency, 2)) as debit_balance_ngn
  from public.journal_entry_lines jel
  join public.journal_entries je on je.id = jel.journal_entry_id and je.status = 'posted'
  join public.accounts a on a.id = jel.account_id
  where a.code in ('1900','2200','2900')
  group by a.code
),
wht_log as (
  select coalesce(sum(withheld_amount - coalesce(remitted_amount, 0)), 0) as outstanding
  from public.wht_remittance_log
)
select 'wht_payable'::text as control,
       'WHT Payable (2200) vs remittance log outstanding'::text as description,
       coalesce((select credit_balance_ngn from gl where code = '2200'), 0) as gl_amount_ngn,
       (select outstanding from wht_log) as subledger_amount_ngn,
       coalesce((select credit_balance_ngn from gl where code = '2200'), 0)
         - (select outstanding from wht_log) as variance_ngn,
       'GL liability began at 0032; pre-existing log rows predate ledger tracking'::text as note
union all
select 'intercompany',
       'Due from related entities (1900) vs due to related entities (2900)',
       coalesce((select debit_balance_ngn from gl where code = '1900'), 0),
       coalesce((select credit_balance_ngn from gl where code = '2900'), 0),
       coalesce((select debit_balance_ngn from gl where code = '1900'), 0)
         - coalesce((select credit_balance_ngn from gl where code = '2900'), 0),
       'Must net to zero at group level; eliminated in consolidation';

grant select on public.control_tieouts to authenticated, hfos_app;
