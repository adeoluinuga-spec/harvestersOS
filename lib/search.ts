import "server-only";
import { sql } from "./db";
import { humanize } from "./enums";
import { money } from "./format";

export type SearchHit = { type: string; label: string; sub: string; href: string };

/**
 * Global search restricted to the caller's scope: super_admin/auditor see all;
 * everyone else only finds entities/givers/requisitions within their accessible
 * entities. Never returns anything outside the user's permission.
 */
export async function globalSearch(q: string, scope: "all" | string[]): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const all = scope === "all";
  const ids = all ? [] : scope;
  if (!all && ids.length === 0) return [];

  const [entities, givers, vendors, reqs, accounts, entries] = await Promise.all([
    sql<{ id: string; name: string; type: string }[]>`
      select id, name, type from public.entities
      where name ilike ${like} and is_active and ${all ? sql`true` : sql`id in ${sql(ids)}`}
      order by name limit 6`,
    sql<{ id: string; full_name: string; phone: string | null }[]>`
      select id, full_name, phone from public.givers
      where is_active and (full_name ilike ${like} or phone ilike ${like} or email ilike ${like})
        ${all ? sql`` : sql`and exists (select 1 from public.giving_records gr where gr.giver_id = givers.id and gr.entity_id in ${sql(ids)})`}
      order by full_name limit 6`,
    sql<{ id: string; name: string }[]>`
      select id, name from public.vendors where name ilike ${like} order by name limit 4`,
    sql<{ id: string; description: string; amount: string; currency: string; entity: string }[]>`
      select rr.id, rr.description, rr.amount, rr.currency, e.name as entity
      from public.requisition_requests rr join public.entities e on e.id = rr.entity_id
      where (rr.description ilike ${like} or rr.category ilike ${like})
        and ${all ? sql`true` : sql`rr.entity_id in ${sql(ids)}`}
      order by rr.created_at desc limit 6`,
    sql<{ id: string; code: string; name: string; account_type: string }[]>`
      select id, code, name, account_type from public.accounts
      where is_active and (code ilike ${like} or name ilike ${like})
      order by code limit 5`,
    // Journal entries by number (JE-2026-000123) or description.
    sql<{ id: string; entry_number: string | null; description: string | null; entity: string; date: string }[]>`
      select je.id, je.entry_number, je.description, e.name as entity,
             je.transaction_date::text as date
      from public.journal_entries je join public.entities e on e.id = je.entity_id
      where je.status in ('posted','reversed')
        and (je.entry_number ilike ${like} or je.description ilike ${like})
        and ${all ? sql`true` : sql`je.entity_id in ${sql(ids)}`}
      order by je.posted_at desc limit 5`,
  ]);

  return [
    ...entities.map((e) => ({ type: "Entity", label: e.name, sub: humanize(e.type), href: `/givings/breakdown/${e.id}` })),
    ...givers.map((g) => ({ type: "Giver", label: g.full_name, sub: g.phone ?? "Giver", href: `/givings/givers/${g.id}` })),
    ...vendors.map((v) => ({ type: "Vendor", label: v.name, sub: "Vendor", href: `/expenses` })),
    ...reqs.map((r) => ({ type: "Requisition", label: r.description, sub: `${r.entity} · ${money(r.amount, r.currency)}`, href: `/expenses/track` })),
    ...accounts.map((a) => ({ type: "Account", label: `${a.code} ${a.name}`, sub: humanize(a.account_type), href: `/reports/ledger/${a.id}` })),
    ...entries.map((j) => ({ type: "Journal entry", label: j.entry_number ?? j.id.slice(0, 8), sub: `${j.entity} · ${j.date} · ${j.description ?? ""}`.slice(0, 60), href: `/reports/entry/${j.id}` })),
  ];
}
