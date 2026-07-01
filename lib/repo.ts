import "server-only";
import { sql, type Exec } from "./db";
import type {
  AccountType,
  AppRole,
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

/**
 * Entities the caller may see. Pass `"all"` for global roles (super_admin /
 * auditor); otherwise pass the caller's accessible entity id set.
 */
export async function getEntities(
  scope: "all" | string[]
): Promise<EntityRow[]> {
  const all = scope === "all";
  const ids = all ? [] : scope;
  if (!all && ids.length === 0) return [];
  return sql<EntityRow[]>`
    select e.id, e.type, e.name, e.country, e.functional_currency,
           e.legal_status, e.is_active, e.start_date, e.end_date,
           p.name as parent_name
    from public.entities e
    left join public.entities p on p.id = e.parent_entity_id
    where ${all ? sql`true` : sql`e.id in ${sql(ids)}`}
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

export async function insertEntity(
  d: EntityInput,
  exec: Exec = sql
): Promise<void> {
  await exec`
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

export async function insertAccount(
  d: AccountInput,
  exec: Exec = sql
): Promise<void> {
  await exec`
    insert into public.accounts (code, name, account_type, fund_classification)
    values (${d.code}, ${d.name},
            ${d.account_type}::public.account_type,
            ${d.fund_classification}::public.fund_classification)`;
}

// ---------------------------------------------------------------------------
// Users & role assignments (admin access management)
// ---------------------------------------------------------------------------
export type UserOption = { id: string; email: string | null };

export type RoleAssignmentRow = {
  id: string;
  user_id: string;
  email: string | null;
  role: AppRole;
  entity_id: string | null;
  entity_name: string | null;
  granted_by_email: string | null;
  granted_at: string;
};

/** Registered auth users, for the assignment picker. */
export async function getUsers(): Promise<UserOption[]> {
  return sql<UserOption[]>`
    select id, email from auth.users order by email`;
}

/** All current user↔entity↔role assignments, newest first. */
export async function getRoleAssignments(): Promise<RoleAssignmentRow[]> {
  return sql<RoleAssignmentRow[]>`
    select uer.id, uer.user_id, u.email, uer.role,
           uer.entity_id, e.name as entity_name,
           gb.email as granted_by_email, uer.granted_at
    from public.user_entity_roles uer
    join auth.users u on u.id = uer.user_id
    left join public.entities e on e.id = uer.entity_id
    left join auth.users gb on gb.id = uer.granted_by
    order by uer.granted_at desc`;
}

export type GrantRoleInput = {
  user_id: string;
  entity_id: string | null;
  role: string;
  granted_by: string;
};

export async function grantRole(
  d: GrantRoleInput,
  exec: Exec = sql
): Promise<void> {
  await exec`
    insert into public.user_entity_roles (user_id, entity_id, role, granted_by)
    values (${d.user_id}, ${d.entity_id}, ${d.role}::public.app_role, ${d.granted_by})`;
}

export async function revokeRole(id: string, exec: Exec = sql): Promise<void> {
  await exec`delete from public.user_entity_roles where id = ${id}`;
}
