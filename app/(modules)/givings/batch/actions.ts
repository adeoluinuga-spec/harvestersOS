"use server";

import { revalidatePath } from "next/cache";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import { recordGiving, type FlaggedMatch } from "@/lib/givings";

export type BatchRowInput = {
  clientKey: string;
  giverName: string;   // empty => anonymous
  giverPhone: string;
  amount: string;
};

export type BatchRowResult = {
  clientKey: string;
  ok: boolean;
  error?: string;
  flagged?: FlaggedMatch[];
};

function canWriteEntity(ctx: AuthContext, entityId: string): boolean {
  if (ctx.isSuperAdmin) return true;
  return (
    ctx.accessibleEntityIds.includes(entityId) &&
    ctx.roles.some((r) => r.role !== "auditor")
  );
}

/**
 * Post a whole service's gifts in one call. Each row is committed
 * independently (a typo in row 14 never loses rows 1–13), resolved through
 * the same giver identity engine as single entry, and idempotent per row
 * (clientKey) so a retried submit cannot double-post.
 */
export async function recordGivingBatch(payload: {
  entityId: string;
  transactionDate: string;
  givingTypeId: string;
  channel: string;
  currency: string;
  rows: BatchRowInput[];
}): Promise<{ results: BatchRowResult[]; error?: string }> {
  const ctx = await requireUser();
  if (!payload.entityId || !canWriteEntity(ctx, payload.entityId))
    return { results: [], error: "You do not have permission to record giving for this entity." };
  if (payload.transactionDate > new Date().toISOString().slice(0, 10))
    return { results: [], error: "The service date cannot be in the future." };
  if (!payload.givingTypeId || !payload.channel)
    return { results: [], error: "Pick a giving type and channel." };
  if (payload.rows.length === 0) return { results: [], error: "No rows to post." };
  if (payload.rows.length > 500) return { results: [], error: "Post at most 500 rows per batch." };

  const results: BatchRowResult[] = [];
  for (const row of payload.rows) {
    const amt = Number(row.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      results.push({ clientKey: row.clientKey, ok: false, error: "Invalid amount" });
      continue;
    }
    const name = row.giverName.trim();
    const resolve = name
      ? {
          mode: "new" as const,
          name,
          phone: row.giverPhone.trim() || null,
          email: null,
          dob: null,
          entityId: payload.entityId,
        }
      : { mode: "anonymous" as const };
    try {
      const res = await withActor(ctx.user.id, (tx) =>
        recordGiving(
          tx,
          {
            resolve,
            entityId: payload.entityId,
            givingTypeId: payload.givingTypeId,
            amount: String(amt),
            currency: payload.currency,
            channel: payload.channel,
            transactionDate: payload.transactionDate,
            note: "Batch service entry",
            pledgeId: null,
            clientKey: row.clientKey,
          },
          ctx.user.id
        )
      );
      results.push({ clientKey: row.clientKey, ok: true, flagged: res.flagged });
    } catch (e) {
      results.push({ clientKey: row.clientKey, ok: false, error: (e as Error).message });
    }
  }

  revalidatePath("/givings");
  return { results };
}
