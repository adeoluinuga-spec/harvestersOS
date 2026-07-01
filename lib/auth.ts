import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { sql } from "./db";
import type { AppRole } from "./enums";

export type RoleAssignment = {
  role: AppRole;
  entity_id: string | null;
  entity_name: string | null;
};

export type AuthContext = {
  user: { id: string; email: string | null };
  roles: RoleAssignment[];
  isSuperAdmin: boolean;
  isAuditor: boolean;
  accessibleEntityIds: string[];
};

/** The authenticated Supabase user (validated against the auth server), or null. */
export async function getUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Full authorization context: identity, role assignments, and accessible entities. */
export async function getContext(): Promise<AuthContext | null> {
  const user = await getUser();
  if (!user) return null;

  const roles = await sql<RoleAssignment[]>`
    select uer.role, uer.entity_id, e.name as entity_name
    from public.user_entity_roles uer
    left join public.entities e on e.id = uer.entity_id
    where uer.user_id = ${user.id}
    order by uer.role`;

  const acc = await sql<{ id: string }[]>`
    select public.accessible_entity_ids(${user.id}) as id`;

  return {
    user: { id: user.id, email: user.email ?? null },
    roles,
    isSuperAdmin: roles.some((r) => r.role === "super_admin"),
    isAuditor: roles.some((r) => r.role === "auditor"),
    accessibleEntityIds: acc.map((r) => r.id),
  };
}

export async function requireUser(): Promise<AuthContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function requireSuperAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (!ctx.isSuperAdmin) redirect("/?denied=admin");
  return ctx;
}

/**
 * Segregation-of-duties guard used before any approve/post action.
 * If the approver created the entry, the attempt is durably logged and refused.
 */
export async function assertCanApprove(
  entryId: string,
  approverId: string
): Promise<void> {
  const [row] = await sql<{ created_by: string | null }[]>`
    select created_by from public.journal_entries where id = ${entryId}`;
  if (row && row.created_by && row.created_by === approverId) {
    await sql`select public.log_sod_violation(${entryId}, ${approverId}, 'attempted self-approval via UI')`;
    throw new Error(
      "Segregation of duties: you cannot approve an entry you created."
    );
  }
}
