import "server-only";
import { sql, type Exec } from "./db";

type Scope = "all" | string[];
const scoped = (col: string, scope: Scope) =>
  scope === "all"
    ? sql`true`
    : scope.length === 0
      ? sql`false`
      : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export async function getInternationalEntities(scope: Scope) {
  return sql`
    select id, name, type, country, functional_currency, legal_status, statutory_jurisdiction
    from public.entities
    where is_active
      and ${scoped("id", scope)}
      and (
        functional_currency <> 'NGN'
        or legal_status = 'separate_foreign_entity'
        or type in ('group','sub_group','campus')
      )
    order by
      case legal_status when 'separate_foreign_entity' then 0 else 1 end,
      name`;
}

export async function getSeparateForeignEntities(scope: Scope) {
  return sql`
    select id, name, country, functional_currency, statutory_jurisdiction
    from public.entities
    where is_active
      and legal_status = 'separate_foreign_entity'
      and ${scoped("id", scope)}
    order by statutory_jurisdiction, name`;
}

export async function getFxRates() {
  return sql`
    select *
    from public.fx_rates
    order by effective_date desc, currency_pair
    limit 100`;
}

export async function addFxRate(
  d: { currencyPair: string; rate: string; effectiveDate: string; source: string; actor: string },
  exec: Exec = sql
) {
  await exec`
    insert into public.fx_rates (currency_pair, rate, effective_date, source, created_by)
    values (${d.currencyPair}, ${d.rate}, ${d.effectiveDate}::date, ${d.source}, ${d.actor})`;
}

export async function getConsolidatedStatement(startDate: string, endDate: string, periodEndRateDate: string) {
  return sql`
    select *
    from public.consolidated_statement_ngn(${startDate}::date, ${endDate}::date, ${periodEndRateDate}::date)
    order by row_type, entity_name, account_code`;
}

export async function getStatutoryStatement(entityId: string, startDate: string, endDate: string) {
  return sql`
    select *
    from public.statutory_statement(${entityId}, ${startDate}::date, ${endDate}::date)
    order by account_code`;
}

export async function getCrossBorderTransfers(scope: Scope) {
  const filter =
    scope === "all"
      ? sql`true`
      : scope.length === 0
        ? sql`false`
        : sql`(cbt.sending_entity_id in ${sql(scope)} or cbt.receiving_entity_id in ${sql(scope)})`;
  return sql`
    select cbt.*, s.name as sending_entity_name, r.name as receiving_entity_name,
           au.email as approved_by_email
    from public.cross_border_transfers cbt
    join public.entities s on s.id = cbt.sending_entity_id
    join public.entities r on r.id = cbt.receiving_entity_id
    left join public.app_users au on au.id = cbt.approved_by
    where ${filter}
    order by cbt.created_at desc`;
}

export async function createCrossBorderTransfer(
  d: {
    sendingEntityId: string;
    receivingEntityId: string;
    direction: string;
    purpose: string;
    amount: string;
    currency: string;
    documentationUrl: string | null;
    actor: string;
  },
  exec: Exec = sql
) {
  await exec`
    insert into public.cross_border_transfers
      (sending_entity_id, receiving_entity_id, direction, purpose, amount, currency,
       supporting_documentation_url, requested_by)
    values
      (${d.sendingEntityId}, ${d.receivingEntityId},
       ${d.direction}::public.cross_border_direction,
       ${d.purpose}::public.cross_border_purpose,
       ${d.amount}, ${d.currency}, ${d.documentationUrl}, ${d.actor})`;
}

export async function documentCrossBorderTransfer(
  d: { transferId: string; documentationUrl: string; status: string; actor: string },
  exec: Exec = sql
) {
  await exec`
    update public.cross_border_transfers
       set supporting_documentation_url = ${d.documentationUrl},
           compliance_status = ${d.status}::public.cross_border_compliance_status,
           approved_by = ${d.actor},
           reviewed_at = now()
     where id = ${d.transferId}`;
}
