"use server";

import { revalidatePath } from "next/cache";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import { resolveOnlinePayment } from "@/lib/onlineGiving";

const FINANCE_ROLES = new Set([
  "super_admin",
  "cfo_coo",
  "group_finance_officer",
  "sub_group_finance_officer",
  "campus_finance_officer",
]);

function canResolve(ctx: AuthContext) {
  return ctx.isSuperAdmin || ctx.roles.some((r) => FINANCE_ROLES.has(r.role));
}

export async function resolveOnlinePaymentAction(formData: FormData): Promise<void> {
  const ctx = await requireUser();
  if (!canResolve(ctx)) return;
  const eventId = String(formData.get("event_id") || "");
  if (!eventId) return;
  const entityId = String(formData.get("entity_id") || "") || null;
  const giverId = String(formData.get("giver_id") || "") || null;
  if (entityId && !ctx.isSuperAdmin && !ctx.accessibleEntityIds.includes(entityId)) return;

  await withActor(ctx.user.id, (tx) =>
    resolveOnlinePayment({ eventId, entityId, giverId, actorId: ctx.user.id }, tx)
  );
  revalidatePath("/givings/online");
  revalidatePath("/givings");
}
