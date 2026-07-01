import "server-only";
import { sql } from "./db";
import type {
  AccountType,
  EntityType,
  FundClassification,
  LegalStatus,
} from "./enums";

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------
export type EntityRow = {
  id: string;
  type: EntityType;
  name: string;
  country: string | null;
  functional_currency: string;
  legal_status: LegalStatus | null;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  parent_name: string | null;
};

export type AccountRow = {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  fund_classification: FundClassification;
  is_active: boolean;
};

export type EntityOption = { id: string; name: string; type: EntityType };

export async function getEntities(): Promise<EntityRow[]> {
  return sql<EntityRow[]>`
    select e.id, e.type, e.name, e.country, e.functional_currency,
           e.legal_status, e.is_active, e.start_date, e.end_date,
           p.name as parent_name
    from public.entities e
    left join public.entities p on p.id = e.parent_entity_id
    order by
      case e.type when 'group' then 0 when 'sub_group' then 1 when 'campus' then 2
                  when 'ministry_expression' then 3 when 'event' then 4 else 5 end,
      e.name`;
}

export async function getEntityOptions(): Promise<EntityOption[]> {
  return sql<EntityOption[]>`
    select id, name, type from public.entities
    where is_active
    order by
      case type when 'group' then 0 when 'sub_group' then 1 when 'campus' then 2
                when 'ministry_expression' then 3 when 'event' then 4 else 5 end,
      name`;
}

export async function getAccounts(): Promise<AccountRow[]> {
  return sql<AccountRow[]>`
    select id, code, name, account_type, fund_classification, is_active
    from public.accounts order by code`;
}

// ---------------------------------------------------------------------------
// Writes (admin)
// ---------------------------------------------------------------------------
export type EntityInput = {
  type: string;
  name: string;
  parent_entity_id: string | null;
  country: string | null;
  functional_currency: string;
  legal_status: string | null;
  start_date: string | null;
  end_date: string | null;
};

export async function insertEntity(d: EntityInput): Promise<void> {
  await sql`
    insert into public.entities
      (type, parent_entity_id, name, country, functional_currency,
       legal_status, start_date, end_date)
    values
      (${d.type}::public.entity_type, ${d.parent_entity_id}, ${d.name},
       ${d.country}, ${d.functional_currency},
       ${d.legal_status}::public.legal_status,
       ${d.start_date}::date, ${d.end_date}::date)`;
}

export type AccountInput = {
  code: string;
  name: string;
  account_type: string;
  fund_classification: string;
};

export async function insertAccount(d: AccountInput): Promise<void> {
  await sql`
    insert into public.accounts (code, name, account_type, fund_classification)
    values (${d.code}, ${d.name},
            ${d.account_type}::public.account_type,
            ${d.fund_classification}::public.fund_classification)`;
}
