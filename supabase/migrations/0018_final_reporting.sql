-- ===========================================================================
-- Harvesters Finance OS - 0018 Final reporting layer
-- Legal/statutory, operational/ministry, programmatic reports, and executive
-- dashboard snapshot.
-- ===========================================================================

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
    group by rf.id, rf.name, rf.entity_id, e.name, a.account_type, a.name, jel.currency
    order by line_group desc, line_type;
    return;
  end if;

  raise exception 'Programmatic view supports event or restricted_fund'
    using errcode = 'check_violation';
end $$;

create or replace function public.executive_dashboard_snapshot(
  p_start_date date,
  p_end_date date
) returns table (
  metric_key text,
  metric_label text,
  metric_value numeric,
  currency text,
  severity text,
  detail jsonb
) language sql stable security invoker set search_path = '' as $$
  with giving as (
    select coalesce(sum(round(gr.amount * public.fx_rate_at(gr.currency::text, 'NGN', gr.transaction_date), 2)), 0) as amount
    from public.giving_records gr
    where gr.transaction_date between p_start_date and p_end_date
  ),
  budget as (
    select coalesce(sum(approved_amount), 0) approved,
           coalesce(sum(actual_amount), 0) actual,
           coalesce(sum(variance_amount), 0) variance
    from public.budget_vs_actual_rollup
    where fiscal_year = extract(year from p_start_date)::int and entity_type = 'group'
  ),
  funds as (
    select coalesce(sum(current_balance), 0) amount
    from public.restricted_fund_balances
  ),
  approvals as (
    select count(*)::numeric as count
    from public.requisition_approvals
    where status = 'pending'
  ),
  compliance as (
    select
      (select count(*) from public.nfiu_flagged_transactions)::numeric
      + (select count(*) from public.wht_remittance_dashboard where is_overdue)
      + (select count(*) from public.cross_border_transfers where compliance_status in ('pending_review','flagged'))::numeric
      as count
  ),
  maturities as (
    select count(*)::numeric as count
    from public.investment_yield_tracking
    where status = 'active' and days_to_maturity between 0 and 30
  )
  select 'consolidated_giving', 'Total consolidated giving', giving.amount, 'NGN',
         'normal', jsonb_build_object('start_date', p_start_date, 'end_date', p_end_date)
  from giving
  union all
  select 'budget_variance', 'Group budget variance', budget.variance, 'NGN',
         case when budget.variance < 0 then 'warning' else 'normal' end,
         jsonb_build_object('approved', budget.approved, 'actual', budget.actual)
  from budget
  union all
  select 'restricted_fund_balances', 'Restricted fund balances', funds.amount, 'NGN',
         'normal', '{}'::jsonb
  from funds
  union all
  select 'pending_approvals', 'Pending approvals', approvals.count, null,
         case when approvals.count > 0 then 'attention' else 'normal' end, '{}'::jsonb
  from approvals
  union all
  select 'compliance_flags', 'Compliance flags', compliance.count, null,
         case when compliance.count > 0 then 'attention' else 'normal' end, '{}'::jsonb
  from compliance
  union all
  select 'investment_maturities', 'Investment maturities in 30 days', maturities.count, null,
         case when maturities.count > 0 then 'attention' else 'normal' end, '{}'::jsonb
  from maturities;
$$;

grant execute on function public.final_statutory_financial_statement(uuid,date,date) to authenticated, service_role;
grant execute on function public.final_operational_ministry_rollup(date,date) to authenticated, service_role;
grant execute on function public.final_programmatic_pl(text,uuid,date,date) to authenticated, service_role;
grant execute on function public.executive_dashboard_snapshot(date,date) to authenticated, service_role;
