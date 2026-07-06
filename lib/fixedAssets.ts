import "server-only";
import { sql, type Exec } from "./db";

type Scope = "all" | string[];
const scoped = (col: string, scope: Scope) =>
  scope === "all" ? sql`true` : scope.length === 0 ? sql`false` : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export type FixedAssetRow = {
  id: string;
  entity_id: string;
  entity_name: string;
  name: string;
  category: string;
  acquisition_date: string;
  cost: string;
  salvage_value: string;
  useful_life_months: number;
  currency: string;
  status: string;
  accumulated_depreciation: string;
  net_book_value: string;
  last_depreciated_period: string | null;
};

export const ASSET_CATEGORIES = [
  "building",
  "land",
  "vehicle",
  "generator",
  "equipment",
  "av_production",
  "furniture",
  "other",
] as const;

export async function getFixedAssetRegister(scope: Scope): Promise<FixedAssetRow[]> {
  return sql<FixedAssetRow[]>`
    select id, entity_id, entity_name, name, category, acquisition_date::text,
           cost::text, salvage_value::text, useful_life_months, currency, status,
           accumulated_depreciation::text, net_book_value::text,
           last_depreciated_period::text
    from public.fixed_asset_register
    where ${scoped("entity_id", scope)}
    order by status, entity_name, name`;
}

export async function getAssetTotals(scope: Scope) {
  const [row] = await sql<{ cost: string; accumulated: string; nbv: string; n: number }[]>`
    select coalesce(sum(cost),0)::text as cost,
           coalesce(sum(accumulated_depreciation),0)::text as accumulated,
           coalesce(sum(net_book_value),0)::text as nbv,
           count(*)::int as n
    from public.fixed_asset_register
    where status <> 'disposed' and ${scoped("entity_id", scope)}`;
  return row;
}

export async function capitalizeAsset(
  d: {
    entityId: string;
    name: string;
    category: string;
    acquisitionDate: string;
    cost: string;
    salvage: string;
    lifeMonths: number;
    funding: "bank" | "opening";
    actor: string;
  },
  exec: Exec = sql
): Promise<string> {
  const [row] = await exec<{ capitalize_fixed_asset: string }[]>`
    select public.capitalize_fixed_asset(
      ${d.entityId}, ${d.name}, ${d.category}, ${d.acquisitionDate}::date,
      ${d.cost}, ${d.salvage}, ${d.lifeMonths}, ${d.funding}, ${d.actor})`;
  return row.capitalize_fixed_asset;
}

export async function runDepreciation(
  period: string | null,
  actor: string,
  exec: Exec = sql
): Promise<{ period: string; assets_depreciated: number; entries_posted: number; total_amount: number }> {
  const [row] = await exec<{ run_monthly_depreciation: never }[]>`
    select public.run_monthly_depreciation(
      coalesce(${period}::date, (date_trunc('month', current_date) - interval '1 month')::date),
      ${actor})`;
  return row.run_monthly_depreciation;
}

export async function disposeAsset(
  d: { assetId: string; disposalDate: string; proceeds: string; actor: string },
  exec: Exec = sql
): Promise<void> {
  await exec`
    select public.dispose_fixed_asset(
      ${d.assetId}, ${d.disposalDate}::date, ${d.proceeds}, ${d.actor})`;
}
