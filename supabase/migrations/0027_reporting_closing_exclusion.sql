-- ===========================================================================
-- Harvesters Finance OS — 0027 Reporting: exclude year-end closing entries
--
-- Closing entries (source_module = 'closing', migration 0023) mechanically
-- zero income/expense into retained earnings. Without exclusion, the first
-- year-end close would wipe every income statement for that year. Rule:
--   • P&L (income/expense) aggregations EXCLUDE closing lines.
--   • Balance-sheet aggregations INCLUDE them (that is their purpose: the
--     equity roll must show).
-- This re-issues the affected functions/views from 0013/0017/0018 with the
-- filter applied; everything else is unchanged.
-- ===========================================================================

-- --- 0013: consolidated statement (period activity excludes closing) --------
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
      -- P&L activity excludes the mechanical year-end close; the equity roll
      -- (3900 line) still shows because equity is not filtered.
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
  select * from cta;
$$;

-- --- 0013: statutory statement ------------------------------------------------
create or replace function public.statutory_statement(
  p_entity_id uuid,
  p_start_date date,
  p_end_date date
) returns table (
  entity_id uuid,
  entity_name text,
  statutory_jurisdiction text,
  account_code text,
  account_name text,
  account_type public.account_type,
  currency char(3),
  debit_amount numeric,
  credit_amount numeric,
  net_amount numeric
) language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.entities
    where id = p_entity_id and legal_status = 'separate_foreign_entity'
  ) then
    raise exception 'Statutory view requires one separate_foreign_entity'
      using errcode = 'check_violation';
  end if;

  return query
  select e.id, e.name, e.statutory_jurisdiction, a.code, a.name, a.account_type,
         jel.currency,
         sum(jel.debit_amount), sum(jel.credit_amount),
         sum(jel.debit_amount - jel.credit_amount)
  from public.journal_entry_lines jel
  join public.journal_entries je on je.id = jel.journal_entry_id
  join public.entities e on e.id = jel.entity_id
  join public.accounts a on a.id = jel.account_id
  where je.status = 'posted'
    and jel.entity_id = p_entity_id
    and je.transaction_date between p_start_date and p_end_date
    and not (je.source_module = 'closing' and a.account_type in ('income','expense'))
  group by e.id, e.name, e.statutory_jurisdiction, a.code, a.name, a.account_type, jel.currency
  order by a.code;
end $$;

-- --- 0017: cash-flow forecast (average income/expense must be operating only)
create or replace view public.analytics_cash_flow_forecast with (security_invoker = true) as
  with ledger_months as (
    select
      jel.entity_id,
      e.name as entity_name,
      date_trunc('month', je.transaction_date)::date as month_start,
      jel.currency,
      sum(jel.credit_amount) filter (where a.account_type = 'income') as income_amount,
      sum(jel.debit_amount) filter (where a.account_type = 'expense') as expense_amount
    from public.journal_entry_lines jel
    join public.journal_entries je on je.id = jel.journal_entry_id and je.status = 'posted'
      and je.source_module <> 'closing'
    join public.accounts a on a.id = jel.account_id
    join public.entities e on e.id = jel.entity_id
    where je.transaction_date >= date_trunc('month', current_date) - interval '6 months'
    group by 1,2,3,4
  ),
  averages as (
    select
      entity_id,
      entity_name,
      currency,
      round(avg(coalesce(income_amount, 0)), 2)::numeric(18,2) as average_monthly_giving,
      round(avg(coalesce(expense_amount, 0)), 2)::numeric(18,2) as average_monthly_expense
    from ledger_months
    group by 1,2,3
  ),
  payroll as (
    select
      pr.entity_id,
      coalesce(sum(pli.net_amount), 0)::numeric(18,2) as last_payroll_net,
      (date_trunc('month', current_date) + interval '1 month')::date as next_payroll_date
    from public.payroll_runs pr
    join public.payroll_line_items pli on pli.payroll_run_id = pr.id
    where pr.status in ('approved','paid')
    group by pr.entity_id
  )
  select
    a.entity_id,
    a.entity_name,
    a.currency,
    a.average_monthly_giving,
    a.average_monthly_expense,
    coalesce(p.last_payroll_net, 0)::numeric(18,2) as next_payroll_estimate,
    p.next_payroll_date,
    round(a.average_monthly_giving - a.average_monthly_expense - coalesce(p.last_payroll_net, 0), 2)::numeric(18,2) as projected_30_day_net,
    (a.average_monthly_giving < a.average_monthly_expense + coalesce(p.last_payroll_net, 0)) as likely_short_before_payroll
  from averages a
  left join payroll p on p.entity_id = a.entity_id
  order by likely_short_before_payroll desc, projected_30_day_net asc;

-- --- 0018: statutory financial statement --------------------------------------
create or replace function public.final_statutory_financial_statement(
  p_entity_id uuid,
  p_start_date date,
  p_end_date date
) returns table (
  view_type text,
  entity_id uuid,
  entity_name text,
  statutory_jurisdiction text,
  statement_name text,
  statement_section text,
  fund_classification public.fund_classification,
  account_code text,
  account_name text,
  currency char(3),
  debit_amount numeric,
  credit_amount numeric,
  net_amount numeric
) language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.entities
    where id = p_entity_id and legal_status = 'separate_foreign_entity'
  ) then
    raise exception 'Legal/statutory view requires one separate_foreign_entity'
      using errcode = 'check_violation';
  end if;

  return query
  with lines as (
    select e.id as entity_id,
           e.name as entity_name,
           e.statutory_jurisdiction,
           a.code as account_code,
           a.name as account_name,
           a.account_type,
           jel.fund_classification,
           jel.currency,
           sum(jel.debit_amount) as debit_amount,
           sum(jel.credit_amount) as credit_amount,
           sum(jel.debit_amount - jel.credit_amount) as debit_net,
           sum(jel.credit_amount - jel.debit_amount) as credit_net
    from public.journal_entry_lines jel
    join public.journal_entries je on je.id = jel.journal_entry_id
    join public.entities e on e.id = jel.entity_id
    join public.accounts a on a.id = jel.account_id
    where je.status = 'posted'
      and jel.entity_id = p_entity_id
      and je.transaction_date between p_start_date and p_end_date
      and not (je.source_module = 'closing' and a.account_type in ('income','expense'))
    group by e.id, e.name, e.statutory_jurisdiction, a.code, a.name,
             a.account_type, jel.fund_classification, jel.currency
  )
  select 'legal_statutory'::text,
         l.entity_id,
         l.entity_name,
         l.statutory_jurisdiction,
         case
           when l.account_type in ('asset','liability','equity') then 'Balance sheet'
           when l.account_type in ('income','expense') then 'Income statement'
           else 'Statement'
         end,
         case
           when l.account_type = 'asset' then 'Assets'
           when l.account_type = 'liability' then 'Liabilities'
           when l.account_type = 'equity' then 'Net assets'
           when l.account_type = 'income' then 'Income'
           when l.account_type = 'expense' then 'Expenses'
         end,
         l.fund_classification,
         l.account_code,
         l.account_name,
         l.currency,
         l.debit_amount,
         l.credit_amount,
         case when l.account_type in ('income','liability','equity')
              then l.credit_net else l.debit_net end
  from lines l
  union all
  select 'legal_statutory'::text,
         e.id,
         e.name,
         e.statutory_jurisdiction,
         'Statement of cash flows by fund',
         'Cash movement',
         jel.fund_classification,
         a.code,
         a.name,
         jel.currency,
         sum(jel.debit_amount),
         sum(jel.credit_amount),
         sum(jel.debit_amount - jel.credit_amount)
  from public.journal_entry_lines jel
  join public.journal_entries je on je.id = jel.journal_entry_id
  join public.entities e on e.id = jel.entity_id
  join public.accounts a on a.id = jel.account_id
  where je.status = 'posted'
    and jel.entity_id = p_entity_id
    and je.transaction_date between p_start_date and p_end_date
    and a.account_type = 'asset'
    and a.code in ('1000','1010')
  group by e.id, e.name, e.statutory_jurisdiction, jel.fund_classification,
           a.code, a.name, jel.currency
  order by statement_name, statement_section, fund_classification, account_code;
end $$;

-- --- 0018: operational ministry rollup -----------------------------------------
create or replace function public.final_operational_ministry_rollup(
  p_start_date date,
  p_end_date date
) returns table (
  view_type text,
  hierarchy_depth int,
  entity_id uuid,
  parent_entity_id uuid,
  entity_name text,
  entity_type public.entity_type,
  currency char(3),
  total_giving numeric,
  total_income numeric,
  total_expense numeric,
  net_position numeric,
  approved_budget numeric,
  budget_actual numeric,
  budget_variance numeric
) language sql stable security invoker set search_path = '' as $$
  with recursive descendants as (
    select e.id as ancestor_id, e.id as entity_id, 0 as depth
    from public.entities e
    union all
    select d.ancestor_id, c.id, d.depth + 1
    from descendants d
    join public.entities c on c.parent_entity_id = d.entity_id
  ),
  ledger as (
    select d.ancestor_id as entity_id,
           jel.currency,
           sum(jel.credit_amount) filter (where a.account_type = 'income') as total_income,
           sum(jel.debit_amount) filter (where a.account_type = 'expense') as total_expense
    from descendants d
    join public.journal_entry_lines jel on jel.entity_id = d.entity_id
    join public.journal_entries je on je.id = jel.journal_entry_id and je.status = 'posted'
      and je.source_module <> 'closing'
    join public.accounts a on a.id = jel.account_id
    where je.transaction_date between p_start_date and p_end_date
    group by d.ancestor_id, jel.currency
  ),
  giving as (
    select d.ancestor_id as entity_id,
           gr.currency,
           sum(gr.amount) as total_giving
    from descendants d
    join public.giving_records gr on coalesce(gr.attribution_entity_id, gr.entity_id) = d.entity_id
    where gr.transaction_date between p_start_date and p_end_date
    group by d.ancestor_id, gr.currency
  ),
  budget as (
    select bva.entity_id,
           sum(bva.approved_amount) as approved_budget,
           sum(bva.actual_amount) as budget_actual,
           sum(bva.variance_amount) as budget_variance
    from public.budget_vs_actual_rollup bva
    where bva.fiscal_year = extract(year from p_start_date)::int
    group by bva.entity_id
  )
  select 'operational_ministry'::text,
         coalesce((select min(depth) from descendants dx where dx.entity_id = e.id), 0) as hierarchy_depth,
         e.id,
         e.parent_entity_id,
         e.name,
         e.type,
         coalesce(l.currency, g.currency, e.functional_currency) as currency,
         coalesce(g.total_giving, 0)::numeric(18,2),
         coalesce(l.total_income, 0)::numeric(18,2),
         coalesce(l.total_expense, 0)::numeric(18,2),
         (coalesce(l.total_income, 0) - coalesce(l.total_expense, 0))::numeric(18,2),
         coalesce(b.approved_budget, 0)::numeric(18,2),
         coalesce(b.budget_actual, 0)::numeric(18,2),
         coalesce(b.budget_variance, 0)::numeric(18,2)
  from public.entities e
  left join ledger l on l.entity_id = e.id
  left join giving g on g.entity_id = e.id and g.currency = coalesce(l.currency, g.currency)
  left join budget b on b.entity_id = e.id
  where e.is_active
  order by e.type, e.name;
$$;

-- --- 0018: programmatic P&L (restricted-fund branch) ----------------------------
create or replace function public.final_programmatic_pl(
  p_program_type text,
  p_program_id uuid,
  p_start_date date,
  p_end_date date
) returns table (
  view_type text,
  program_type text,
  program_id uuid,
  program_name text,
  host_entity_id uuid,
  host_entity_name text,
  line_group text,
  line_type text,
  currency char(3),
  revenue_amount numeric,
  cost_amount numeric,
  net_amount numeric
) language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_program_type = 'event' then
    return query
    select 'programmatic'::text,
           'event'::text,
           ed.id,
           ed.event_name,
           ed.hosting_entity_id,
           host.name,
           'Revenue'::text,
           erl.revenue_type::text,
           erl.currency,
           sum(erl.amount)::numeric(18,2),
           0::numeric(18,2),
           sum(erl.amount)::numeric(18,2)
    from public.event_details ed
    join public.entities host on host.id = ed.hosting_entity_id
    join public.event_revenue_lines erl on erl.event_detail_id = ed.id
    where ed.id = p_program_id and erl.received_at between p_start_date and p_end_date
    group by ed.id, ed.event_name, ed.hosting_entity_id, host.name, erl.revenue_type, erl.currency
    union all
    select 'programmatic'::text,
           'event'::text,
           ed.id,
           ed.event_name,
           ed.hosting_entity_id,
           host.name,
           'Cost'::text,
           ecl.cost_type::text,
           ecl.currency,
           0::numeric(18,2),
           sum(ecl.amount)::numeric(18,2),
           -sum(ecl.amount)::numeric(18,2)
    from public.event_details ed
    join public.entities host on host.id = ed.hosting_entity_id
    join public.event_cost_lines ecl on ecl.event_detail_id = ed.id
    where ed.id = p_program_id and ecl.incurred_at between p_start_date and p_end_date
    group by ed.id, ed.event_name, ed.hosting_entity_id, host.name, ecl.cost_type, ecl.currency
    order by line_group desc, line_type;
    return;
  end if;

  if p_program_type = 'restricted_fund' then
    return query
    select 'programmatic'::text,
           'restricted_fund'::text,
           rf.id,
           rf.name,
           rf.entity_id,
           e.name,
           case when a.account_type = 'income' then 'Revenue'
                when a.account_type = 'expense' then 'Cost'
                else 'Balance movement' end,
           a.name,
           jel.currency,
           sum(jel.credit_amount) filter (where a.account_type = 'income')::numeric(18,2),
           sum(jel.debit_amount) filter (where a.account_type = 'expense')::numeric(18,2),
           sum(case when a.account_type = 'income' then jel.credit_amount
                    when a.account_type = 'expense' then -jel.debit_amount
                    else jel.credit_amount - jel.debit_amount end)::numeric(18,2)
    from public.restricted_funds rf
    join public.entities e on e.id = rf.entity_id
    join public.journal_entry_lines jel
      on jel.entity_id = rf.entity_id and jel.fund_classification = rf.fund_classification
    join public.journal_entries je on je.id = jel.journal_entry_id and je.status = 'posted'
    join public.accounts a on a.id = jel.account_id
    where rf.id = p_program_id and je.transaction_date between p_start_date and p_end_date
      and not (je.source_module = 'closing' and a.account_type in ('income','expense'))
    group by rf.id, rf.name, rf.entity_id, e.name, a.account_type, a.name, jel.currency
    order by line_group desc, line_type;
    return;
  end if;

  raise exception 'Programmatic view supports event or restricted_fund'
    using errcode = 'check_violation';
end $$;
