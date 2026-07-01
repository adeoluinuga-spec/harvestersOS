import "server-only";
import { sql, type Exec } from "./db";

type Scope = "all" | string[];
const scoped = (col: string, scope: Scope) =>
  scope === "all"
    ? sql`true`
    : scope.length === 0
      ? sql`false`
      : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export async function getNextLevelPrayersEntity(scope: Scope) {
  const [row] = await sql<Record<string, string>[]>`
    select id, name, type, functional_currency
    from public.entities
    where lower(name) = lower('Next Level Prayers')
      and is_active
      and ${scoped("id", scope)}
    limit 1`;
  return row ?? null;
}

export async function getPartnerDirectory(entityId: string) {
  return sql`
    select *
    from public.partnership_directory
    where entity_id = ${entityId}
    order by status, full_name`;
}

export async function getPartnerDashboard(entityId: string) {
  const [counts, tiers, lapsed, recent, summary, products, sales, programs] =
    await Promise.all([
      sql`
        select
          count(*)::int as total_partners,
          count(*) filter (where status = 'active')::int as active_partners,
          count(*) filter (where status = 'lapsed')::int as lapsed_partners,
          count(*) filter (where status = 'paused')::int as paused_partners
        from public.partners
        where entity_id = ${entityId}`,
      sql`
        select coalesce(tier_name, 'Unassigned') as tier_name,
               count(*)::int as partner_count,
               coalesce(sum(committed_monthly_amount), 0) as monthly_commitment,
               max(currency) as currency
        from public.partnership_directory
        where entity_id = ${entityId}
        group by coalesce(tier_name, 'Unassigned')
        order by monthly_commitment desc`,
      sql`
        select lf.*, d.full_name, d.tier_name, d.committed_monthly_amount,
               d.currency, d.last_payment_date
        from public.partnership_lapse_flags lf
        join public.partnership_directory d on d.partner_id = lf.partner_id
        where d.entity_id = ${entityId} and lf.status = 'open'
        order by lf.detected_at desc`,
      sql`
        select d.full_name, d.tier_name, pf.amount, pf.fulfilled_month, gr.transaction_date,
               gr.currency
        from public.partnership_fulfillments pf
        join public.partnership_directory d on d.commitment_id = pf.commitment_id
        join public.giving_records gr on gr.id = pf.giving_record_id
        where d.entity_id = ${entityId}
        order by gr.transaction_date desc, pf.created_at desc
        limit 8`,
      sql`
        select *
        from public.nlp_financial_summary
        where entity_id = ${entityId}
        order by currency`,
      sql`
        select *
        from public.digital_products
        where entity_id = ${entityId}
        order by created_at desc`,
      sql`
        select dps.*, dp.name as product_name, g.full_name as giver_name
        from public.digital_product_sales dps
        join public.digital_products dp on dp.id = dps.digital_product_id
        left join public.givers g on g.id = dps.giver_id
        where dp.entity_id = ${entityId}
        order by dps.sale_date desc, dps.created_at desc
        limit 25`,
      sql`
        select ed.*, e.name as event_entity_name
        from public.event_details ed
        join public.entities e on e.id = ed.entity_id
        where ed.hosting_entity_id = ${entityId}
        order by ed.start_date desc
        limit 10`,
    ]);

  return {
    counts: counts[0] ?? {
      total_partners: 0,
      active_partners: 0,
      lapsed_partners: 0,
      paused_partners: 0,
    },
    tiers,
    lapsed,
    recent,
    summary,
    products,
    sales,
    programs,
  };
}

export async function getPartnershipTiers(entityId: string) {
  return sql`
    select *
    from public.partnership_tiers
    where entity_id = ${entityId} and is_active
    order by sort_order, min_monthly_amount`;
}

export async function getActiveGivers() {
  return sql`
    select id, full_name, phone, email
    from public.givers
    where is_active
    order by full_name
    limit 300`;
}

export async function createPartnershipTier(
  d: {
    entityId: string;
    name: string;
    minMonthlyAmount: string;
    maxMonthlyAmount: string | null;
    currency: string;
    sortOrder: string;
  },
  exec: Exec = sql
) {
  await exec`
    insert into public.partnership_tiers
      (entity_id, name, min_monthly_amount, max_monthly_amount, currency, sort_order)
    values
      (${d.entityId}, ${d.name}, ${d.minMonthlyAmount}, ${d.maxMonthlyAmount},
       ${d.currency}, ${d.sortOrder})
    on conflict (entity_id, name) do update
      set min_monthly_amount = excluded.min_monthly_amount,
          max_monthly_amount = excluded.max_monthly_amount,
          currency = excluded.currency,
          sort_order = excluded.sort_order,
          is_active = true`;
}

export async function createPartner(
  d: { entityId: string; giverId: string; tierId: string | null; startDate: string; status: string },
  exec: Exec = sql
) {
  const [row] = await exec<{ id: string }[]>`
    insert into public.partners
      (giver_id, entity_id, partnership_tier_id, start_date, status)
    values
      (${d.giverId}, ${d.entityId}, ${d.tierId}, ${d.startDate}::date,
       ${d.status}::public.partnership_status)
    on conflict (giver_id, entity_id) do update
      set partnership_tier_id = excluded.partnership_tier_id,
          status = excluded.status
    returning id`;
  return row.id;
}

export async function createCommitment(
  d: {
    partnerId: string;
    committedMonthlyAmount: string;
    currency: string;
    startMonth: string;
    expectedDay: string;
  },
  exec: Exec = sql
) {
  await exec`
    insert into public.partnership_commitments
      (partner_id, committed_monthly_amount, currency, start_month, expected_day)
    values
      (${d.partnerId}, ${d.committedMonthlyAmount}, ${d.currency},
       date_trunc('month', ${d.startMonth}::date)::date, ${d.expectedDay})`;
}

export async function recordPartnershipPayment(
  d: {
    commitmentId: string;
    amount: string;
    currency: string;
    channel: string;
    transactionDate: string;
    actor: string;
    note: string | null;
  },
  exec: Exec = sql
) {
  const [row] = await exec<{ record_partnership_payment: string }[]>`
    select public.record_partnership_payment(
      ${d.commitmentId}, ${d.amount}, ${d.currency},
      ${d.channel}::public.giving_channel, ${d.transactionDate}::date,
      ${d.actor}, ${d.note}
    )`;
  return row.record_partnership_payment;
}

export async function detectPartnerLapses(asOf: string, exec: Exec = sql) {
  return exec`
    select * from public.detect_lapsed_partners(${asOf}::date)`;
}

export async function createDigitalProduct(
  d: {
    entityId: string;
    name: string;
    productType: string;
    accessPeriodDays: string;
    priceAmount: string;
    currency: string;
  },
  exec: Exec = sql
) {
  await exec`
    insert into public.digital_products
      (entity_id, name, product_type, access_period_days, price_amount, currency)
    values
      (${d.entityId}, ${d.name}, ${d.productType}::public.digital_product_type,
       ${d.accessPeriodDays}, ${d.priceAmount}, ${d.currency})
    on conflict (entity_id, name) do update
      set product_type = excluded.product_type,
          access_period_days = excluded.access_period_days,
          price_amount = excluded.price_amount,
          currency = excluded.currency,
          is_active = true`;
}

export async function createDigitalProductSale(
  d: {
    productId: string;
    giverId: string | null;
    saleDate: string;
    amount: string;
    currency: string;
    accessStartDate: string;
    accessEndDate: string;
    actor: string;
  },
  exec: Exec = sql
) {
  await exec`
    insert into public.digital_product_sales
      (digital_product_id, giver_id, sale_date, amount, currency,
       access_start_date, access_end_date, created_by)
    values
      (${d.productId}, ${d.giverId}, ${d.saleDate}::date, ${d.amount}, ${d.currency},
       ${d.accessStartDate}::date, ${d.accessEndDate}::date, ${d.actor})`;
}
