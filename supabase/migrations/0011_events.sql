-- ===========================================================================
-- Harvesters Finance OS - 0011 Events as temporary cost-center entities
-- Event mini-P&L, attribution rules, cost sharing, lightweight inventory.
-- ===========================================================================

do $$ begin create type public.event_status as enum
  ('planning','active','closed');
exception when duplicate_object then null; end $$;

do $$ begin create type public.event_revenue_type as enum
  ('ticket_sales','sponsorships','exhibitor_fees','on_site_giving','offerings','merchandise');
exception when duplicate_object then null; end $$;

do $$ begin create type public.event_cost_type as enum
  ('venue','logistics','speaker_honorarium','hospitality_accommodation','staffing','production_simulcast','other');
exception when duplicate_object then null; end $$;

do $$ begin create type public.event_split_type as enum
  ('percentage','fixed_amount');
exception when duplicate_object then null; end $$;

do $$ begin create type public.event_attribution_policy as enum
  ('host_entity','giver_home_entity','split');
exception when duplicate_object then null; end $$;

do $$ begin create type public.event_inventory_movement_type as enum
  ('stocked','sold','returned','adjusted','unsold');
exception when duplicate_object then null; end $$;

create table if not exists public.event_details (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null unique references public.entities(id) on delete cascade,
  event_name text not null,
  event_type text not null default 'general',
  hosting_entity_id uuid not null references public.entities(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  attendee_count int not null default 0 check (attendee_count >= 0),
  status public.event_status not null default 'planning',
  created_at timestamptz not null default now(),
  constraint event_dates_valid check (end_date >= start_date)
);
create index if not exists idx_event_details_host on public.event_details(hosting_entity_id, status);

create table if not exists public.event_attribution_rules (
  id uuid primary key default gen_random_uuid(),
  event_detail_id uuid not null unique references public.event_details(id) on delete cascade,
  policy public.event_attribution_policy not null default 'host_entity',
  host_entity_percentage numeric(7,4) check (host_entity_percentage is null or (host_entity_percentage >= 0 and host_entity_percentage <= 100)),
  giver_home_entity_percentage numeric(7,4) check (giver_home_entity_percentage is null or (giver_home_entity_percentage >= 0 and giver_home_entity_percentage <= 100)),
  notes text,
  created_at timestamptz not null default now(),
  constraint attribution_split_total check (
    policy <> 'split'
    or coalesce(host_entity_percentage,0) + coalesce(giver_home_entity_percentage,0) = 100
  )
);

create table if not exists public.event_revenue_lines (
  id uuid primary key default gen_random_uuid(),
  event_detail_id uuid not null references public.event_details(id) on delete cascade,
  revenue_type public.event_revenue_type not null,
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null,
  source_entity_id uuid references public.entities(id) on delete restrict,
  description text,
  received_at date not null default current_date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_event_revenue_event on public.event_revenue_lines(event_detail_id, revenue_type);

create table if not exists public.event_cost_lines (
  id uuid primary key default gen_random_uuid(),
  event_detail_id uuid not null references public.event_details(id) on delete cascade,
  cost_type public.event_cost_type not null,
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null,
  honorarium_payment_id uuid references public.honorarium_payments(id) on delete restrict,
  description text not null,
  incurred_at date not null default current_date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint hospitality_description_required check (
    cost_type <> 'hospitality_accommodation' or length(trim(description)) >= 8
  )
);
create index if not exists idx_event_cost_event on public.event_cost_lines(event_detail_id, cost_type);

create table if not exists public.event_cost_sharing_splits (
  id uuid primary key default gen_random_uuid(),
  event_cost_line_id uuid not null references public.event_cost_lines(id) on delete cascade,
  contributing_entity_id uuid not null references public.entities(id) on delete restrict,
  split_type public.event_split_type not null,
  percentage numeric(7,4),
  fixed_amount numeric(18,2),
  created_at timestamptz not null default now(),
  constraint event_split_value check (
    (split_type = 'percentage' and percentage is not null and percentage > 0 and percentage <= 100 and fixed_amount is null)
    or (split_type = 'fixed_amount' and fixed_amount is not null and fixed_amount > 0 and percentage is null)
  )
);
create index if not exists idx_event_cost_splits_cost on public.event_cost_sharing_splits(event_cost_line_id);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  event_detail_id uuid not null references public.event_details(id) on delete cascade,
  sku text,
  item_name text not null,
  unit_cost numeric(18,2) not null default 0 check (unit_cost >= 0),
  unit_price numeric(18,2) not null default 0 check (unit_price >= 0),
  currency char(3) not null default 'NGN',
  created_at timestamptz not null default now(),
  unique (event_detail_id, item_name)
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  movement_type public.event_inventory_movement_type not null,
  quantity int not null check (quantity <> 0),
  unit_amount numeric(18,2),
  occurred_at date not null default current_date,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_inventory_movements_item on public.inventory_movements(inventory_item_id, occurred_at);

create or replace view public.event_profit_and_loss with (security_invoker = true) as
with revenue as (
  select event_detail_id, currency, sum(amount) as total_revenue
  from public.event_revenue_lines group by event_detail_id, currency
),
costs as (
  select event_detail_id, currency, sum(amount) as total_cost
  from public.event_cost_lines group by event_detail_id, currency
),
currencies as (
  select event_detail_id, currency from revenue
  union
  select event_detail_id, currency from costs
)
select ed.id as event_detail_id,
       ed.entity_id,
       ed.event_name,
       ed.event_type,
       ed.hosting_entity_id,
       host.name as hosting_entity_name,
       ed.start_date,
       ed.end_date,
       ed.attendee_count,
       ed.status,
       c.currency,
       coalesce(r.total_revenue, 0) as total_revenue,
       coalesce(co.total_cost, 0) as total_cost,
       coalesce(r.total_revenue, 0) - coalesce(co.total_cost, 0) as net_position,
       case when ed.attendee_count > 0
            then round(coalesce(co.total_cost, 0) / ed.attendee_count, 2)
            else null end as cost_per_attendee
from public.event_details ed
join public.entities host on host.id = ed.hosting_entity_id
left join currencies c on c.event_detail_id = ed.id
left join revenue r on r.event_detail_id = ed.id and r.currency = c.currency
left join costs co on co.event_detail_id = ed.id and co.currency = c.currency;

create or replace view public.event_inventory_balances with (security_invoker = true) as
select ii.id as inventory_item_id,
       ii.event_detail_id,
       ii.item_name,
       ii.sku,
       ii.currency,
       ii.unit_cost,
       ii.unit_price,
       coalesce(sum(case when im.movement_type in ('stocked','returned','adjusted') then im.quantity
                         when im.movement_type in ('sold','unsold') then -abs(im.quantity)
                         else im.quantity end), 0) as quantity_on_hand,
       coalesce(sum(case when im.movement_type = 'sold' then abs(im.quantity) else 0 end), 0) as quantity_sold
from public.inventory_items ii
left join public.inventory_movements im on im.inventory_item_id = ii.id
group by ii.id;

create or replace view public.event_historical_comparison with (security_invoker = true) as
select ed.id as event_detail_id,
       ed.event_name,
       ed.event_type,
       ed.start_date,
       ed.attendee_count,
       coalesce(sum(erl.amount), 0) as total_revenue,
       coalesce((select sum(ecl.amount) from public.event_cost_lines ecl where ecl.event_detail_id = ed.id), 0) as total_cost,
       coalesce(sum(erl.amount), 0) - coalesce((select sum(ecl.amount) from public.event_cost_lines ecl where ecl.event_detail_id = ed.id), 0) as net_position
from public.event_details ed
left join public.event_revenue_lines erl on erl.event_detail_id = ed.id
group by ed.id;

do $$
declare t text;
begin
  foreach t in array array[
    'event_details','event_attribution_rules','event_revenue_lines','event_cost_lines',
    'event_cost_sharing_splits','inventory_items','inventory_movements'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function app_private.tg_audit()', t);
  end loop;
end $$;

grant select on public.event_profit_and_loss,
                public.event_inventory_balances,
                public.event_historical_comparison
  to authenticated;

drop policy if exists event_details_select on public.event_details;
create policy event_details_select on public.event_details for select to authenticated
  using (public.user_can_access_entity(entity_id) or public.user_can_access_entity(hosting_entity_id));
drop policy if exists event_attribution_rules_select on public.event_attribution_rules;
create policy event_attribution_rules_select on public.event_attribution_rules for select to authenticated
  using (exists (
    select 1 from public.event_details ed
    where ed.id = event_detail_id and (public.user_can_access_entity(ed.entity_id) or public.user_can_access_entity(ed.hosting_entity_id))
  ));
drop policy if exists event_revenue_lines_select on public.event_revenue_lines;
create policy event_revenue_lines_select on public.event_revenue_lines for select to authenticated
  using (exists (
    select 1 from public.event_details ed
    where ed.id = event_detail_id and (public.user_can_access_entity(ed.entity_id) or public.user_can_access_entity(ed.hosting_entity_id))
  ));
drop policy if exists event_cost_lines_select on public.event_cost_lines;
create policy event_cost_lines_select on public.event_cost_lines for select to authenticated
  using (exists (
    select 1 from public.event_details ed
    where ed.id = event_detail_id and (public.user_can_access_entity(ed.entity_id) or public.user_can_access_entity(ed.hosting_entity_id))
  ));
drop policy if exists event_cost_sharing_splits_select on public.event_cost_sharing_splits;
create policy event_cost_sharing_splits_select on public.event_cost_sharing_splits for select to authenticated
  using (exists (
    select 1 from public.event_cost_lines ecl
    join public.event_details ed on ed.id = ecl.event_detail_id
    where ecl.id = event_cost_line_id and (public.user_can_access_entity(ed.entity_id) or public.user_can_access_entity(ed.hosting_entity_id))
  ));
drop policy if exists inventory_items_select on public.inventory_items;
create policy inventory_items_select on public.inventory_items for select to authenticated
  using (exists (
    select 1 from public.event_details ed
    where ed.id = event_detail_id and (public.user_can_access_entity(ed.entity_id) or public.user_can_access_entity(ed.hosting_entity_id))
  ));
drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select on public.inventory_movements for select to authenticated
  using (exists (
    select 1 from public.inventory_items ii
    join public.event_details ed on ed.id = ii.event_detail_id
    where ii.id = inventory_item_id and (public.user_can_access_entity(ed.entity_id) or public.user_can_access_entity(ed.hosting_entity_id))
  ));
