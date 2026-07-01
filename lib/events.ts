import "server-only";
import { sql, type Exec } from "./db";

type Scope = "all" | string[];
const scoped = (col: string, scope: Scope) =>
  scope === "all"
    ? sql`true`
    : scope.length === 0
      ? sql`false`
      : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export async function getEventHostEntities(scope: Scope) {
  return sql`
    select id, name, type, country, functional_currency, legal_status
    from public.entities
    where is_active and type <> 'event' and ${scoped("id", scope)}
    order by name`;
}

export async function getEventDetails(scope: Scope) {
  return sql`
    select ed.*, e.name as entity_name, host.name as hosting_entity_name,
           coalesce(pl.total_revenue, 0) as total_revenue,
           coalesce(pl.total_cost, 0) as total_cost,
           coalesce(pl.net_position, 0) as net_position,
           pl.currency
    from public.event_details ed
    join public.entities e on e.id = ed.entity_id
    join public.entities host on host.id = ed.hosting_entity_id
    left join lateral (
      select sum(total_revenue) as total_revenue, sum(total_cost) as total_cost,
             sum(net_position) as net_position, min(currency) as currency
      from public.event_profit_and_loss p where p.event_detail_id = ed.id
    ) pl on true
    where ${scope === "all" ? sql`true` : scope.length === 0 ? sql`false` : sql`(ed.entity_id in ${sql(scope)} or ed.hosting_entity_id in ${sql(scope)})`}
    order by ed.start_date desc`;
}

export async function createEvent(
  d: {
    eventName: string;
    eventType: string;
    hostingEntityId: string;
    startDate: string;
    endDate: string;
    attendeeCount: string;
    status: string;
  },
  exec: Exec = sql
) {
  const [host] = await exec<
    { country: string | null; functional_currency: string; legal_status: string | null }[]
  >`select country, functional_currency, legal_status from public.entities where id = ${d.hostingEntityId}`;
  const [entity] = await exec<{ id: string }[]>`
    insert into public.entities
      (type, parent_entity_id, name, country, functional_currency, legal_status, start_date, end_date)
    values
      ('event', ${d.hostingEntityId}, ${d.eventName}, ${host?.country ?? "NG"},
       ${host?.functional_currency ?? "NGN"}, ${host?.legal_status ?? "unincorporated_unit"}::public.legal_status,
       ${d.startDate}::date, ${d.endDate}::date)
    returning id`;
  const [detail] = await exec<{ id: string }[]>`
    insert into public.event_details
      (entity_id, event_name, event_type, hosting_entity_id, start_date, end_date, attendee_count, status)
    values
      (${entity.id}, ${d.eventName}, ${d.eventType || "general"}, ${d.hostingEntityId},
       ${d.startDate}::date, ${d.endDate}::date, ${d.attendeeCount || "0"}, ${d.status}::public.event_status)
    returning id`;
  await exec`
    insert into public.event_attribution_rules (event_detail_id, policy)
    values (${detail.id}, 'host_entity')
    on conflict (event_detail_id) do nothing`;
  return detail.id;
}

export async function updateEventAttribution(
  d: { eventDetailId: string; policy: string; hostPct: string | null; giverPct: string | null; notes: string | null },
  exec: Exec = sql
) {
  await exec`
    insert into public.event_attribution_rules
      (event_detail_id, policy, host_entity_percentage, giver_home_entity_percentage, notes)
    values
      (${d.eventDetailId}, ${d.policy}::public.event_attribution_policy,
       ${d.hostPct}, ${d.giverPct}, ${d.notes})
    on conflict (event_detail_id) do update
      set policy = excluded.policy,
          host_entity_percentage = excluded.host_entity_percentage,
          giver_home_entity_percentage = excluded.giver_home_entity_percentage,
          notes = excluded.notes`;
}

export async function addEventRevenue(
  d: {
    eventDetailId: string;
    revenueType: string;
    amount: string;
    currency: string;
    sourceEntityId: string | null;
    description: string | null;
    receivedAt: string;
    actor: string;
  },
  exec: Exec = sql
) {
  await exec`
    insert into public.event_revenue_lines
      (event_detail_id, revenue_type, amount, currency, source_entity_id, description, received_at, created_by)
    values
      (${d.eventDetailId}, ${d.revenueType}::public.event_revenue_type, ${d.amount},
       ${d.currency}, ${d.sourceEntityId}, ${d.description}, ${d.receivedAt}::date, ${d.actor})`;
}

export async function addEventCost(
  d: {
    eventDetailId: string;
    costType: string;
    amount: string;
    currency: string;
    honorariumId: string | null;
    description: string;
    incurredAt: string;
    actor: string;
    splitEntityId: string | null;
    splitType: string | null;
    splitValue: string | null;
  },
  exec: Exec = sql
) {
  const [cost] = await exec<{ id: string }[]>`
    insert into public.event_cost_lines
      (event_detail_id, cost_type, amount, currency, honorarium_payment_id, description, incurred_at, created_by)
    values
      (${d.eventDetailId}, ${d.costType}::public.event_cost_type, ${d.amount},
       ${d.currency}, ${d.honorariumId}, ${d.description}, ${d.incurredAt}::date, ${d.actor})
    returning id`;
  if (d.splitEntityId && d.splitType && d.splitValue) {
    await exec`
      insert into public.event_cost_sharing_splits
        (event_cost_line_id, contributing_entity_id, split_type, percentage, fixed_amount)
      values
        (${cost.id}, ${d.splitEntityId}, ${d.splitType}::public.event_split_type,
         ${d.splitType === "percentage" ? d.splitValue : null},
         ${d.splitType === "fixed_amount" ? d.splitValue : null})`;
  }
}

export async function getEventRevenueLines(eventDetailId?: string) {
  const filter = eventDetailId ? sql`erl.event_detail_id = ${eventDetailId}` : sql`true`;
  return sql`
    select erl.*, ed.event_name, source.name as source_entity_name
    from public.event_revenue_lines erl
    join public.event_details ed on ed.id = erl.event_detail_id
    left join public.entities source on source.id = erl.source_entity_id
    where ${filter}
    order by erl.received_at desc, erl.created_at desc
    limit 50`;
}

export async function getEventCostLines(eventDetailId?: string) {
  const filter = eventDetailId ? sql`ecl.event_detail_id = ${eventDetailId}` : sql`true`;
  return sql`
    select ecl.*, ed.event_name,
           count(split.id)::int as split_count
    from public.event_cost_lines ecl
    join public.event_details ed on ed.id = ecl.event_detail_id
    left join public.event_cost_sharing_splits split on split.event_cost_line_id = ecl.id
    where ${filter}
    group by ecl.id, ed.event_name
    order by ecl.incurred_at desc, ecl.created_at desc
    limit 50`;
}

export async function createInventoryItem(
  d: { eventDetailId: string; sku: string | null; itemName: string; unitCost: string; unitPrice: string; currency: string },
  exec: Exec = sql
) {
  const [row] = await exec<{ id: string }[]>`
    insert into public.inventory_items
      (event_detail_id, sku, item_name, unit_cost, unit_price, currency)
    values (${d.eventDetailId}, ${d.sku}, ${d.itemName}, ${d.unitCost}, ${d.unitPrice}, ${d.currency})
    on conflict (event_detail_id, item_name) do update
      set sku = excluded.sku, unit_cost = excluded.unit_cost, unit_price = excluded.unit_price, currency = excluded.currency
    returning id`;
  return row.id;
}

export async function addInventoryMovement(
  d: { itemId: string; movementType: string; quantity: string; unitAmount: string | null; occurredAt: string; notes: string | null; actor: string },
  exec: Exec = sql
) {
  await exec`
    insert into public.inventory_movements
      (inventory_item_id, movement_type, quantity, unit_amount, occurred_at, notes, created_by)
    values
      (${d.itemId}, ${d.movementType}::public.event_inventory_movement_type,
       ${d.quantity}, ${d.unitAmount}, ${d.occurredAt}::date, ${d.notes}, ${d.actor})`;
}

export async function getInventoryBalances(eventDetailId?: string) {
  const filter = eventDetailId ? sql`b.event_detail_id = ${eventDetailId}` : sql`true`;
  return sql`
    select b.*, ed.event_name
    from public.event_inventory_balances b
    join public.event_details ed on ed.id = b.event_detail_id
    where ${filter}
    order by ed.event_name, b.item_name`;
}

export async function getEventCloseout(eventDetailId?: string) {
  const filter = eventDetailId ? sql`p.event_detail_id = ${eventDetailId}` : sql`true`;
  return sql`
    select p.*
    from public.event_profit_and_loss p
    where ${filter}
    order by p.start_date desc, p.currency`;
}

export async function getEventHistoricalComparison(eventType?: string) {
  const filter = eventType ? sql`event_type = ${eventType}` : sql`true`;
  return sql`
    select *
    from public.event_historical_comparison
    where ${filter}
    order by start_date desc
    limit 12`;
}

export async function getHonorariumsForEventCost() {
  return sql`
    select id, recipient_name, amount, currency, status
    from public.honorarium_payments
    order by created_at desc
    limit 100`;
}
