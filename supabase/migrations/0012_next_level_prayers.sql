-- ===========================================================================
-- Harvesters Finance OS - 0012 Next Level Prayers partnerships
-- NLP is a ministry directorate/special ministry with partners, monthly
-- commitments fulfilled through giving_records, events, deferred revenue, and
-- resident intercessor honorariums through the honorarium pattern.
-- ===========================================================================

alter type public.entity_type add value if not exists 'ministry_directorate';
alter type public.honorarium_recipient_type add value if not exists 'resident_intercessor';

commit;

do $$ begin create type public.partnership_status as enum
  ('active','lapsed','paused');
exception when duplicate_object then null; end $$;

do $$ begin create type public.digital_product_type as enum
  ('devotional','course','subscription','other');
exception when duplicate_object then null; end $$;

do $$ begin create type public.digital_sale_status as enum
  ('active','completed','cancelled');
exception when duplicate_object then null; end $$;

do $$
declare v_parent uuid;
begin
  select id into v_parent from public.entities
  where type = 'group'
  order by created_at
  limit 1;

  if exists (select 1 from public.entities where lower(name) = lower('Next Level Prayers')) then
    update public.entities
       set type = 'ministry_directorate'::public.entity_type,
           parent_entity_id = coalesce(parent_entity_id, v_parent),
           is_active = true
     where lower(name) = lower('Next Level Prayers');
  elsif v_parent is not null then
    insert into public.entities
      (type, parent_entity_id, name, country, functional_currency, legal_status)
    values
      ('ministry_directorate', v_parent, 'Next Level Prayers', 'NG', 'NGN',
       'unincorporated_unit');
  end if;
end $$;

create table if not exists public.partnership_tiers (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  name text not null,
  min_monthly_amount numeric(18,2) not null default 0 check (min_monthly_amount >= 0),
  max_monthly_amount numeric(18,2) check (max_monthly_amount is null or max_monthly_amount >= min_monthly_amount),
  currency char(3) not null default 'NGN',
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (entity_id, name)
);
create index if not exists idx_partnership_tiers_entity on public.partnership_tiers(entity_id, is_active);

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  giver_id uuid not null references public.givers(id) on delete restrict,
  entity_id uuid not null references public.entities(id) on delete restrict,
  partnership_tier_id uuid references public.partnership_tiers(id) on delete set null,
  start_date date not null default current_date,
  status public.partnership_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (giver_id, entity_id)
);
create index if not exists idx_partners_entity_status on public.partners(entity_id, status);
create index if not exists idx_partners_giver on public.partners(giver_id);

create table if not exists public.partnership_commitments (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  committed_monthly_amount numeric(18,2) not null check (committed_monthly_amount > 0),
  currency char(3) not null default 'NGN',
  start_month date not null default date_trunc('month', current_date)::date,
  expected_day int not null default 1 check (expected_day between 1 and 28),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_commitments_partner on public.partnership_commitments(partner_id, is_active);

create table if not exists public.partnership_fulfillments (
  id uuid primary key default gen_random_uuid(),
  commitment_id uuid not null references public.partnership_commitments(id) on delete cascade,
  giving_record_id uuid not null references public.giving_records(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  fulfilled_month date not null,
  created_at timestamptz not null default now(),
  unique (giving_record_id)
);
create index if not exists idx_partner_fulfillments_commitment
  on public.partnership_fulfillments(commitment_id, fulfilled_month);

create table if not exists public.partnership_lapse_flags (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  commitment_id uuid not null references public.partnership_commitments(id) on delete cascade,
  first_missed_month date not null,
  missed_periods int not null check (missed_periods >= 2),
  detected_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open','resolved')),
  resolved_at timestamptz
);
create unique index if not exists idx_partner_lapse_open
  on public.partnership_lapse_flags(commitment_id) where status = 'open';

create table if not exists public.digital_products (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete restrict,
  name text not null,
  product_type public.digital_product_type not null,
  access_period_days int not null default 30 check (access_period_days > 0),
  price_amount numeric(18,2) not null check (price_amount >= 0),
  currency char(3) not null default 'NGN',
  deferred_revenue_account_id uuid references public.accounts(id) on delete restrict,
  revenue_account_id uuid references public.accounts(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (entity_id, name)
);
create index if not exists idx_digital_products_entity on public.digital_products(entity_id, is_active);

create table if not exists public.digital_product_sales (
  id uuid primary key default gen_random_uuid(),
  digital_product_id uuid not null references public.digital_products(id) on delete restrict,
  giver_id uuid references public.givers(id) on delete restrict,
  sale_date date not null default current_date,
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null default 'NGN',
  access_start_date date not null,
  access_end_date date not null,
  recognition_schedule jsonb not null default '[]'::jsonb,
  recognized_amount numeric(18,2) not null default 0 check (recognized_amount >= 0),
  status public.digital_sale_status not null default 'active',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint digital_sale_dates_valid check (access_end_date >= access_start_date),
  constraint digital_sale_recognized_valid check (recognized_amount <= amount)
);
create index if not exists idx_digital_sales_product on public.digital_product_sales(digital_product_id, sale_date);

insert into public.partnership_tiers
  (entity_id, name, min_monthly_amount, max_monthly_amount, currency, sort_order)
select e.id, v.name, v.min_amt, v.max_amt, e.functional_currency, v.ord
from public.entities e
cross join (values
  ('Seed Partner', 0::numeric, 49999::numeric, 1),
  ('Builder Partner', 50000::numeric, 199999::numeric, 2),
  ('Legacy Partner', 200000::numeric, null::numeric, 3)
) as v(name, min_amt, max_amt, ord)
where lower(e.name) = lower('Next Level Prayers')
on conflict (entity_id, name) do nothing;

create or replace function public.record_partnership_payment(
  p_commitment_id uuid,
  p_amount numeric,
  p_currency text,
  p_channel public.giving_channel,
  p_transaction_date date,
  p_recorded_by uuid default null,
  p_note text default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  c record;
  v_type uuid;
  v_giving uuid;
begin
  select pc.id, pc.partner_id, p.giver_id, p.entity_id
    into c
  from public.partnership_commitments pc
  join public.partners p on p.id = pc.partner_id
  where pc.id = p_commitment_id and pc.is_active;

  if not found then
    raise exception 'Active partnership commitment not found' using errcode = 'check_violation';
  end if;

  select id into v_type from public.giving_types where code = 'partnership' and is_active;
  if v_type is null then
    raise exception 'Partnership giving type is not configured' using errcode = 'check_violation';
  end if;

  insert into public.giving_records
    (giver_id, entity_id, giving_type_id, amount, currency, channel, transaction_date, recorded_by, note)
  values
    (c.giver_id, c.entity_id, v_type, p_amount, upper(p_currency)::char(3),
     p_channel, p_transaction_date, p_recorded_by, p_note)
  returning id into v_giving;

  perform public.post_giving_record(v_giving);

  insert into public.partnership_fulfillments
    (commitment_id, giving_record_id, amount, fulfilled_month)
  values
    (p_commitment_id, v_giving, p_amount, date_trunc('month', p_transaction_date)::date);

  update public.partnership_lapse_flags
     set status = 'resolved', resolved_at = now()
   where commitment_id = p_commitment_id and status = 'open';

  update public.partners
     set status = 'active'
   where id = c.partner_id and status = 'lapsed';

  return v_giving;
end $$;
revoke all on function public.record_partnership_payment(uuid,numeric,text,public.giving_channel,date,uuid,text)
  from public, anon, authenticated;

create or replace function public.detect_lapsed_partners(p_as_of date default current_date)
returns table (partner_id uuid, commitment_id uuid, missed_periods int)
language plpgsql volatile security definer set search_path = '' as $$
declare
  r record;
  m0 date := date_trunc('month', p_as_of)::date;
  m1 date := (date_trunc('month', p_as_of) - interval '1 month')::date;
begin
  for r in
    select pc.id as commitment_id, pc.partner_id
    from public.partnership_commitments pc
    join public.partners p on p.id = pc.partner_id
    where pc.is_active
      and p.status <> 'paused'
      and pc.start_month <= m1
      and not exists (
        select 1 from public.partnership_fulfillments pf
        where pf.commitment_id = pc.id and pf.fulfilled_month = m0
      )
      and not exists (
        select 1 from public.partnership_fulfillments pf
        where pf.commitment_id = pc.id and pf.fulfilled_month = m1
      )
  loop
    insert into public.partnership_lapse_flags
      (partner_id, commitment_id, first_missed_month, missed_periods)
    values
      (r.partner_id, r.commitment_id, m1, 2)
    on conflict (commitment_id) where status = 'open' do update
      set missed_periods = greatest(public.partnership_lapse_flags.missed_periods, 2),
          detected_at = now();

    update public.partners set status = 'lapsed' where id = r.partner_id;
    partner_id := r.partner_id;
    commitment_id := r.commitment_id;
    missed_periods := 2;
    return next;
  end loop;
end $$;
revoke all on function public.detect_lapsed_partners(date) from public, anon, authenticated;

create or replace function public.build_recognition_schedule(
  p_amount numeric,
  p_start date,
  p_end date
) returns jsonb language sql stable set search_path = '' as $$
  with months as (
    select generate_series(date_trunc('month', p_start)::date,
                           date_trunc('month', p_end)::date,
                           interval '1 month')::date as month_start
  ),
  counted as (
    select month_start, count(*) over () as n from months
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'month', to_char(month_start, 'YYYY-MM'),
      'amount', round(p_amount / nullif(n, 0), 2)
    ) order by month_start
  ), '[]'::jsonb)
  from counted;
$$;

create or replace function app_private.tg_digital_sale_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.recognition_schedule is null or new.recognition_schedule = '[]'::jsonb then
    new.recognition_schedule := public.build_recognition_schedule(
      new.amount, new.access_start_date, new.access_end_date
    );
  end if;
  return new;
end $$;
drop trigger if exists trg_digital_sale_schedule on public.digital_product_sales;
create trigger trg_digital_sale_schedule before insert or update of amount, access_start_date, access_end_date
  on public.digital_product_sales
  for each row execute function app_private.tg_digital_sale_schedule();

create or replace view public.partnership_directory with (security_invoker = true) as
select p.id as partner_id,
       p.entity_id,
       e.name as entity_name,
       p.giver_id,
       g.full_name,
       g.phone,
       g.email,
       pt.name as tier_name,
       p.start_date,
       p.status,
       pc.id as commitment_id,
       pc.committed_monthly_amount,
       pc.currency,
       pc.start_month,
       coalesce(sum(pf.amount), 0) as lifetime_fulfilled_amount,
       max(gr.transaction_date) as last_payment_date
from public.partners p
join public.entities e on e.id = p.entity_id
join public.givers g on g.id = p.giver_id
left join public.partnership_tiers pt on pt.id = p.partnership_tier_id
left join public.partnership_commitments pc on pc.partner_id = p.id and pc.is_active
left join public.partnership_fulfillments pf on pf.commitment_id = pc.id
left join public.giving_records gr on gr.id = pf.giving_record_id
group by p.id, e.name, g.id, pt.name, pc.id;

create or replace view public.nlp_financial_summary with (security_invoker = true) as
with nlp as (
  select id from public.entities where lower(name) = lower('Next Level Prayers') limit 1
),
giving as (
  select gr.entity_id, gt.code, gr.currency, sum(gr.amount) as amount
  from public.giving_records gr
  join public.giving_types gt on gt.id = gr.giving_type_id
  where gr.entity_id in (select id from nlp)
  group by gr.entity_id, gt.code, gr.currency
),
honoraria as (
  select entity_id, currency, sum(amount) as amount
  from public.honorarium_payments
  where entity_id in (select id from nlp)
  group by entity_id, currency
),
digital as (
  select dp.entity_id, dps.currency, sum(dps.amount) as amount,
         sum(dps.amount - dps.recognized_amount) as deferred_amount
  from public.digital_product_sales dps
  join public.digital_products dp on dp.id = dps.digital_product_id
  group by dp.entity_id, dps.currency
),
events as (
  select hosting_entity_id as entity_id, currency,
         sum(total_revenue) as revenue, sum(total_cost) as cost
  from public.event_profit_and_loss
  where hosting_entity_id in (select id from nlp)
  group by hosting_entity_id, currency
)
select e.id as entity_id,
       e.name as entity_name,
       coalesce(g.currency, h.currency, d.currency, ev.currency, e.functional_currency) as currency,
       coalesce(sum(g.amount) filter (where g.code = 'partnership'), 0) as partnership_giving,
       coalesce(sum(g.amount) filter (where g.code <> 'partnership'), 0) as other_giving,
       coalesce(sum(d.amount), 0) as digital_sales,
       coalesce(sum(d.deferred_amount), 0) as deferred_revenue,
       coalesce(sum(ev.revenue), 0) as event_revenue,
       coalesce(sum(ev.cost), 0) as event_cost,
       coalesce(sum(h.amount), 0) as honorarium_stipends
from public.entities e
left join giving g on g.entity_id = e.id
left join honoraria h on h.entity_id = e.id and h.currency = coalesce(g.currency, h.currency)
left join digital d on d.entity_id = e.id and d.currency = coalesce(g.currency, h.currency, d.currency)
left join events ev on ev.entity_id = e.id and ev.currency = coalesce(g.currency, h.currency, d.currency, ev.currency)
where e.id in (select id from nlp)
group by e.id, coalesce(g.currency, h.currency, d.currency, ev.currency, e.functional_currency);

do $$
declare t text;
begin
  foreach t in array array[
    'partnership_tiers','partners','partnership_commitments',
    'partnership_fulfillments','partnership_lapse_flags',
    'digital_products','digital_product_sales'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function app_private.tg_audit()', t);
  end loop;
end $$;

grant select on public.partnership_directory, public.nlp_financial_summary
  to authenticated;
grant execute on function public.build_recognition_schedule(numeric,date,date) to service_role;

drop policy if exists partnership_tiers_select on public.partnership_tiers;
create policy partnership_tiers_select on public.partnership_tiers for select to authenticated
  using (public.user_can_access_entity(entity_id));

drop policy if exists partners_select on public.partners;
create policy partners_select on public.partners for select to authenticated
  using (public.user_can_access_entity(entity_id));

drop policy if exists partnership_commitments_select on public.partnership_commitments;
create policy partnership_commitments_select on public.partnership_commitments for select to authenticated
  using (exists (
    select 1 from public.partners p
    where p.id = partner_id and public.user_can_access_entity(p.entity_id)
  ));

drop policy if exists partnership_fulfillments_select on public.partnership_fulfillments;
create policy partnership_fulfillments_select on public.partnership_fulfillments for select to authenticated
  using (exists (
    select 1 from public.partnership_commitments pc
    join public.partners p on p.id = pc.partner_id
    where pc.id = commitment_id and public.user_can_access_entity(p.entity_id)
  ));

drop policy if exists partnership_lapse_flags_select on public.partnership_lapse_flags;
create policy partnership_lapse_flags_select on public.partnership_lapse_flags for select to authenticated
  using (exists (
    select 1 from public.partners p
    where p.id = partner_id and public.user_can_access_entity(p.entity_id)
  ));

drop policy if exists digital_products_select on public.digital_products;
create policy digital_products_select on public.digital_products for select to authenticated
  using (public.user_can_access_entity(entity_id));

drop policy if exists digital_product_sales_select on public.digital_product_sales;
create policy digital_product_sales_select on public.digital_product_sales for select to authenticated
  using (exists (
    select 1 from public.digital_products dp
    where dp.id = digital_product_id and public.user_can_access_entity(dp.entity_id)
  ));
