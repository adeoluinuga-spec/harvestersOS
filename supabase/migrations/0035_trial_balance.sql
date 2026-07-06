-- ===========================================================================
-- Harvesters Finance OS — 0035 Trial balance (drill-down report writer, level 1)
--
-- One scoped, period-filtered trial balance over the ledger, in presentation
-- currency. Every number on it can be opened: account -> journal entries ->
-- entry detail -> source record & documents (app routes under /reports).
-- Closing entries are excluded from P&L rows by default (0027 rule) but can
-- be included for equity-roll inspection.
-- ===========================================================================

create or replace function public.trial_balance(
  p_start_date date,
  p_end_date date,
  p_entity_ids uuid[] default null,        -- null = all entities
  p_include_closing boolean default false
) returns table (
  account_id uuid,
  account_code text,
  account_name text,
  account_type public.account_type,
  debit_ngn numeric,
  credit_ngn numeric,
  net_ngn numeric,
  line_count int
) language sql stable security invoker set search_path = '' as $$
  select a.id,
         a.code,
         a.name,
         a.account_type,
         coalesce(sum(round(jel.debit_amount * jel.fx_rate_to_presentation_currency, 2)), 0),
         coalesce(sum(round(jel.credit_amount * jel.fx_rate_to_presentation_currency, 2)), 0),
         coalesce(sum(round(
           case when a.account_type in ('asset','expense')
                then jel.debit_amount - jel.credit_amount
                else jel.credit_amount - jel.debit_amount
           end * jel.fx_rate_to_presentation_currency, 2)), 0),
         count(jel.id)::int
  from public.accounts a
  join public.journal_entry_lines jel on jel.account_id = a.id
  join public.journal_entries je on je.id = jel.journal_entry_id
  where je.status = 'posted'
    and je.transaction_date between p_start_date and p_end_date
    and (p_entity_ids is null or jel.entity_id = any(p_entity_ids))
    and (p_include_closing
         or not (je.source_module = 'closing' and a.account_type in ('income','expense')))
  group by a.id, a.code, a.name, a.account_type
  order by a.code;
$$;
grant execute on function public.trial_balance(date, date, uuid[], boolean)
  to authenticated, hfos_app, service_role;
