-- ===========================================================================
-- Harvesters Finance OS - 0017 AI analytics layer
-- Read-only analytics views plus audited natural-language query logs.
-- ===========================================================================

create table if not exists public.ai_query_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  entity_scope uuid[],
  prompt text not null,
  generated_sql text,
  result_preview jsonb,
  status text not null default 'answered' check (status in ('answered','rejected','error')),
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_query_logs_user_time on public.ai_query_logs(user_id, created_at desc);
create index if not exists idx_ai_query_logs_status_time on public.ai_query_logs(status, created_at desc);

create or replace view public.analytics_giving_monthly with (security_invoker = true) as
  select
    date_trunc('month', gr.transaction_date)::date as month_start,
    coalesce(gr.attribution_entity_id, gr.entity_id) as entity_id,
    e.name as entity_name,
    gr.recording_entity_id,
    rec.name as recording_entity_name,
    gt.code as giving_type_code,
    gt.name as giving_type_name,
    gr.currency,
    count(*)::int as gift_count,
    count(distinct gr.giver_id)::int as giver_count,
    sum(gr.amount)::numeric(18,2) as total_amount
  from public.giving_records gr
  join public.giving_types gt on gt.id = gr.giving_type_id
  join public.entities e on e.id = coalesce(gr.attribution_entity_id, gr.entity_id)
  left join public.entities rec on rec.id = gr.recording_entity_id
  group by 1,2,3,4,5,6,7,8;

create or replace view public.analytics_giving_yoy with (security_invoker = true) as
  with monthly as (
    select
      entity_id,
      entity_name,
      giving_type_code,
      giving_type_name,
      currency,
      extract(year from month_start)::int as giving_year,
      extract(month from month_start)::int as giving_month,
      sum(total_amount)::numeric(18,2) as total_amount
    from public.analytics_giving_monthly
    group by 1,2,3,4,5,6,7
  )
  select
    m.*,
    p.total_amount as previous_year_amount,
    case
      when coalesce(p.total_amount, 0) = 0 then null
      else round(((m.total_amount - p.total_amount) / p.total_amount) * 100, 2)
    end as yoy_change_percent
  from monthly m
  left join monthly p
    on p.entity_id = m.entity_id
   and p.giving_type_code = m.giving_type_code
   and p.currency = m.currency
   and p.giving_month = m.giving_month
   and p.giving_year = m.giving_year - 1;

create or replace view public.analytics_giving_seasonality with (security_invoker = true) as
  select
    entity_id,
    entity_name,
    extract(month from month_start)::int as giving_month,
    to_char(month_start, 'Mon') as month_label,
    currency,
    round(avg(total_amount), 2)::numeric(18,2) as average_monthly_amount,
    sum(total_amount)::numeric(18,2) as historical_total_amount,
    sum(gift_count)::int as historical_gift_count
  from public.analytics_giving_monthly
  group by 1,2,3,4,5;

create or replace view public.analytics_giving_velocity_alerts with (security_invoker = true) as
  with entity_velocity as (
    select
      'entity'::text as subject_type,
      coalesce(gr.attribution_entity_id, gr.entity_id) as entity_id,
      e.name as entity_name,
      null::uuid as giver_id,
      e.name as subject_name,
      gr.currency,
      sum(gr.amount) filter (where gr.transaction_date >= current_date - interval '30 days') as current_amount,
      sum(gr.amount) filter (where gr.transaction_date >= current_date - interval '60 days' and gr.transaction_date < current_date - interval '30 days') as previous_amount
    from public.giving_records gr
    join public.entities e on e.id = coalesce(gr.attribution_entity_id, gr.entity_id)
    group by 2,3,6
  ),
  giver_velocity as (
    select
      'giver'::text as subject_type,
      coalesce(gr.attribution_entity_id, gr.entity_id) as entity_id,
      e.name as entity_name,
      gr.giver_id,
      gv.full_name as subject_name,
      gr.currency,
      sum(gr.amount) filter (where gr.transaction_date >= current_date - interval '30 days') as current_amount,
      sum(gr.amount) filter (where gr.transaction_date >= current_date - interval '60 days' and gr.transaction_date < current_date - interval '30 days') as previous_amount
    from public.giving_records gr
    join public.entities e on e.id = coalesce(gr.attribution_entity_id, gr.entity_id)
    join public.givers gv on gv.id = gr.giver_id
    group by 2,3,4,5,6
  ),
  scored as (
    select *,
      case
        when coalesce(previous_amount, 0) = 0 and coalesce(current_amount, 0) > 0 then 1000
        when coalesce(previous_amount, 0) = 0 then null
        else round(((coalesce(current_amount, 0) - previous_amount) / previous_amount) * 100, 2)
      end as change_percent
    from (
      select * from entity_velocity
      union all
      select * from giver_velocity
    ) v
  )
  select
    subject_type,
    entity_id,
    entity_name,
    giver_id,
    subject_name,
    currency,
    coalesce(current_amount, 0)::numeric(18,2) as current_amount,
    coalesce(previous_amount, 0)::numeric(18,2) as previous_amount,
    change_percent,
    case when change_percent <= -50 then 'drop' else 'spike' end as alert_kind,
    case
      when change_percent <= -50 then 'Pastoral care opportunity: giving has slowed materially in the last 30 days.'
      else 'Pastoral care opportunity: giving has increased sharply; consider gratitude and relationship follow-up.'
    end as pastoral_care_message
  from scored
  where (coalesce(previous_amount, 0) >= 10000 or coalesce(current_amount, 0) >= 10000)
    and (change_percent <= -50 or change_percent >= 100)
  order by abs(change_percent) desc nulls last;

create or replace view public.analytics_hni_givers with (security_invoker = true) as
  with giver_totals as (
    select
      gr.giver_id,
      gv.full_name,
      gv.email,
      gv.phone,
      coalesce(gv.primary_entity_id, (array_agg(coalesce(gr.attribution_entity_id, gr.entity_id) order by gr.transaction_date desc))[1]) as entity_id,
      max(e.name) filter (where e.id = coalesce(gv.primary_entity_id, coalesce(gr.attribution_entity_id, gr.entity_id))) as entity_name,
      gr.currency,
      sum(gr.amount)::numeric(18,2) as lifetime_amount,
      count(*)::int as gift_count,
      max(gr.transaction_date) as last_gift_date
    from public.giving_records gr
    join public.givers gv on gv.id = gr.giver_id
    left join public.entities e on e.id = coalesce(gv.primary_entity_id, coalesce(gr.attribution_entity_id, gr.entity_id))
    group by gr.giver_id, gv.full_name, gv.email, gv.phone, gv.primary_entity_id, gr.currency
  ),
  percentile_floor as (
    select
      currency,
      percentile_disc(0.99) within group (order by lifetime_amount) as top_percentile_floor
    from giver_totals
    group by currency
  )
  select gt.*, pf.top_percentile_floor,
    (gt.lifetime_amount >= pf.top_percentile_floor) as is_top_percentile
  from giver_totals gt
  join percentile_floor pf on pf.currency = gt.currency
  order by lifetime_amount desc;

create or replace view public.analytics_lapsed_major_givers with (security_invoker = true) as
  with giving_windows as (
    select
      h.giver_id,
      h.full_name,
      h.email,
      h.phone,
      h.entity_id,
      h.entity_name,
      h.currency,
      h.lifetime_amount,
      h.gift_count,
      h.last_gift_date,
      coalesce(sum(gr.amount) filter (where gr.transaction_date >= current_date - interval '90 days'), 0)::numeric(18,2) as last_90_amount,
      coalesce(sum(gr.amount) filter (where gr.transaction_date >= current_date - interval '180 days' and gr.transaction_date < current_date - interval '90 days'), 0)::numeric(18,2) as previous_90_amount
    from public.analytics_hni_givers h
    left join public.giving_records gr on gr.giver_id = h.giver_id and gr.currency = h.currency
    where h.is_top_percentile or h.gift_count >= 12
    group by h.giver_id, h.full_name, h.email, h.phone, h.entity_id, h.entity_name, h.currency, h.lifetime_amount, h.gift_count, h.last_gift_date
  )
  select *,
    case
      when last_gift_date < current_date - interval '90 days' then 'No gift in 90+ days'
      when previous_90_amount > 0 and last_90_amount < previous_90_amount * 0.5 then 'Giving pace slowed by 50%+'
      else 'Monitor'
    end as lapse_reason
  from giving_windows
  where last_gift_date < current_date - interval '90 days'
     or (previous_90_amount > 0 and last_90_amount < previous_90_amount * 0.5)
  order by lifetime_amount desc;

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

create or replace view public.analytics_expense_anomaly_flags with (security_invoker = true) as
  with base as (
    select
      rr.id as source_id,
      rr.entity_id,
      e.name as entity_name,
      rr.vendor_id,
      v.name as vendor_name,
      rr.category,
      rr.description,
      rr.amount,
      rr.currency,
      rr.created_at::date as transaction_date
    from public.requisition_requests rr
    join public.entities e on e.id = rr.entity_id
    left join public.vendors v on v.id = rr.vendor_id
    where rr.created_at >= now() - interval '180 days'
  ),
  vendor_spend as (
    select entity_id, vendor_id, sum(amount) as vendor_amount
    from base
    where vendor_id is not null and transaction_date >= current_date - interval '90 days'
    group by 1,2
  ),
  entity_spend as (
    select entity_id, sum(vendor_amount) as entity_amount
    from vendor_spend
    group by 1
  ),
  thresholds as (
    select amount_threshold_min as threshold_amount from public.approval_chain_templates where amount_threshold_min is not null
    union
    select amount_threshold from public.board_approval_triggers where condition_type = 'amount_threshold' and amount_threshold is not null and is_active
  ),
  flags as (
    select b.*, 'round_number'::text as flag_type, 'Round-number expense; review supporting detail.'::text as flag_reason
    from base b
    where mod(b.amount, 100000) = 0
    union all
    select b.*, 'weekend_dated'::text, 'Expense was dated on a weekend.'
    from base b
    where extract(isodow from b.transaction_date) in (6,7)
    union all
    select b.*, 'vendor_concentration'::text, 'Vendor concentration exceeds 50% of entity spend in the last 90 days.'
    from base b
    join vendor_spend vs on vs.entity_id = b.entity_id and vs.vendor_id = b.vendor_id
    join entity_spend es on es.entity_id = b.entity_id
    where es.entity_amount > 0 and vs.vendor_amount / es.entity_amount >= 0.5
    union all
    select b.*, 'just_under_threshold'::text, 'Amount is within 5% below an approval threshold.'
    from base b
    join thresholds t on b.amount >= t.threshold_amount * 0.95 and b.amount < t.threshold_amount
  )
  select * from flags
  order by transaction_date desc, amount desc;

do $$
begin
  alter table public.ai_query_logs enable row level security;
  revoke all on public.ai_query_logs from anon, authenticated;
  grant select on public.ai_query_logs to authenticated;
  grant all on public.ai_query_logs to service_role;
end $$;

drop policy if exists ai_query_logs_select on public.ai_query_logs;
create policy ai_query_logs_select on public.ai_query_logs for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_super_admin()
    or exists (
      select 1 from public.user_entity_roles uer
      where uer.user_id = auth.uid() and uer.role = 'auditor'
    )
  );

grant select on
  public.analytics_giving_monthly,
  public.analytics_giving_yoy,
  public.analytics_giving_seasonality,
  public.analytics_giving_velocity_alerts,
  public.analytics_hni_givers,
  public.analytics_lapsed_major_givers,
  public.analytics_cash_flow_forecast,
  public.analytics_expense_anomaly_flags
to authenticated, service_role;

drop trigger if exists trg_audit on public.ai_query_logs;
create trigger trg_audit after insert or update or delete on public.ai_query_logs
  for each row execute function app_private.tg_audit();
