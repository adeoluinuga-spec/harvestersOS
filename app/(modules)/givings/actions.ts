"use server";

import { revalidatePath } from "next/cache";
import { withActor } from "@/lib/db";
import { requireUser, type AuthContext } from "@/lib/auth";
import {
  dismissMergeCandidate,
  getGivingTypeIdByCode,
  getPledge,
  insertPledge,
  mergeGivers as repoMergeGivers,
  recordGiving as repoRecordGiving,
  type FlaggedMatch,
} from "@/lib/givings";
import { PLEDGE_TYPE_TO_GIVING_CODE } from "@/lib/enums";

export type GivingFormState = {
  ok?: boolean;
  error?: string;
  message?: string;
  flagged?: FlaggedMatch[];
};

const FINANCE_ROLES = [
  "group_finance_officer",
  "sub_group_finance_officer",
  "campus_finance_officer",
];

function canWriteEntity(ctx: AuthContext, entityId: string): boolean {
  if (ctx.isSuperAdmin) return true;
  return (
    ctx.accessibleEntityIds.includes(entityId) &&
    ctx.roles.some((r) => r.role !== "auditor")
  );
}
const isFinanceOrAdmin = (ctx: AuthContext) =>
  ctx.isSuperAdmin || ctx.roles.some((r) => FINANCE_ROLES.includes(r.role));

export async function recordGiving(
  _prev: GivingFormState,
  formData: FormData
): Promise<GivingFormState> {
  const ctx = await requireUser();

  const entityId = String(formData.get("entity_id") || "");
  if (!entityId) return { error: "Select the receiving entity." };
  if (!canWriteEntity(ctx, entityId))
    return { error: "You do not have permission to record giving for this entity." };

  const mode = String(formData.get("giver_mode") || "new");
  const givingTypeId = String(formData.get("giving_type_id") || "");
  const amount = String(formData.get("amount") || "").trim();
  const currency = String(formData.get("currency") || "NGN").trim().toUpperCase();
  const channel = String(formData.get("channel") || "");
  const transactionDate = String(formData.get("transaction_date") || "");
  const note = String(formData.get("note") || "").trim() || null;
  const pledgeId = String(formData.get("pledge_id") || "") || null;

  if (!givingTypeId) return { error: "Select a giving type." };
  if (!channel) return { error: "Select a channel." };
  if (!transactionDate) return { error: "Select the transaction date." };
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { error: "Enter a valid amount greater than zero." };

  let resolve;
  if (mode === "existing") {
    const giverId = String(formData.get("giver_id") || "");
    if (!giverId) return { error: "Select an existing giver." };
    resolve = { mode: "existing" as const, giverId };
  } else if (mode === "anonymous") {
    resolve = { mode: "anonymous" as const };
  } else {
    const name = String(formData.get("giver_name") || "").trim();
    if (!name) return { error: "Enter the giver's name (or choose Anonymous)." };
    resolve = {
      mode: "new" as const,
      name,
      phone: String(formData.get("giver_phone") || "").trim() || null,
      email: String(formData.get("giver_email") || "").trim() || null,
      dob: String(formData.get("giver_dob") || "") || null,
      entityId,
    };
  }

  try {
    const res = await withActor(ctx.user.id, (tx) =>
      repoRecordGiving(
        tx,
        {
          resolve,
          entityId,
          givingTypeId,
          amount,
          currency,
          channel,
          transactionDate,
          note,
          pledgeId,
        },
        ctx.user.id
      )
    );
    revalidatePath("/givings/record");
    revalidatePath("/givings");
    return {
      ok: true,
      message: `Recorded and posted ${currency} ${amt.toLocaleString()}.`,
      flagged: res.flagged,
    };
  } catch (e) {
    return { error: (e as Error).message || "Failed to record giving." };
  }
}

export async function createPledge(
  _prev: GivingFormState,
  formData: FormData
): Promise<GivingFormState> {
  const ctx = await requireUser();
  const entity_id = String(formData.get("entity_id") || "");
  if (!entity_id) return { error: "Select an entity." };
  if (!canWriteEntity(ctx, entity_id))
    return { error: "You do not have permission to create pledges for this entity." };

  const giver_id = String(formData.get("giver_id") || "");
  const pledge_type = String(formData.get("pledge_type") || "");
  const total = String(formData.get("total_pledged_amount") || "").trim();
  const currency = String(formData.get("currency") || "NGN").trim().toUpperCase();
  const target = String(formData.get("target_fulfillment_date") || "") || null;

  if (!giver_id) return { error: "Select a giver." };
  if (!pledge_type) return { error: "Select a pledge type." };
  if (!(Number(total) > 0)) return { error: "Enter a valid pledge amount." };

  try {
    await withActor(ctx.user.id, (tx) =>
      insertPledge(
        {
          giver_id,
          entity_id,
          pledge_type,
          total_pledged_amount: total,
          currency,
          target_fulfillment_date: target,
        },
        tx
      )
    );
  } catch (e) {
    return { error: (e as Error).message || "Failed to create pledge." };
  }
  revalidatePath("/givings/pledges");
  return { ok: true, message: "Pledge created." };
}

export async function recordPledgePayment(
  _prev: GivingFormState,
  formData: FormData
): Promise<GivingFormState> {
  const ctx = await requireUser();
  const pledgeId = String(formData.get("pledge_id") || "");
  const amount = String(formData.get("amount") || "").trim();
  const channel = String(formData.get("channel") || "cash");

  const pledge = await getPledge(pledgeId);
  if (!pledge) return { error: "Pledge not found." };
  if (!canWriteEntity(ctx, pledge.entity_id))
    return { error: "You do not have permission to record against this pledge." };
  if (!(Number(amount) > 0)) return { error: "Enter a valid amount." };

  const code = PLEDGE_TYPE_TO_GIVING_CODE[pledge.pledge_type];
  const givingTypeId = code ? await getGivingTypeIdByCode(code) : null;
  if (!givingTypeId) return { error: "No giving type mapped for this pledge type." };

  try {
    await withActor(ctx.user.id, (tx) =>
      repoRecordGiving(
        tx,
        {
          resolve: { mode: "existing", giverId: pledge.giver_id },
          entityId: pledge.entity_id,
          givingTypeId,
          amount,
          currency: pledge.currency,
          channel,
          transactionDate: new Date().toISOString().slice(0, 10),
          note: "Pledge payment",
          pledgeId,
        },
        ctx.user.id
      )
    );
  } catch (e) {
    return { error: (e as Error).message || "Failed to record payment." };
  }
  revalidatePath("/givings/pledges");
  return { ok: true, message: "Payment recorded against pledge." };
}

export async function mergeGiversAction(formData: FormData): Promise<void> {
  const ctx = await requireUser();
  if (!isFinanceOrAdmin(ctx)) return;
  const keep = String(formData.get("keep_id") || "");
  const merge = String(formData.get("merge_id") || "");
  if (!keep || !merge) return;
  await withActor(ctx.user.id, (tx) => repoMergeGivers(keep, merge, ctx.user.id, tx));
  revalidatePath("/givings/duplicates");
}

export async function dismissDuplicateAction(formData: FormData): Promise<void> {
  const ctx = await requireUser();
  if (!isFinanceOrAdmin(ctx)) return;
  const id = String(formData.get("id") || "");
  if (!id) return;
  await withActor(ctx.user.id, (tx) => dismissMergeCandidate(id, ctx.user.id, tx));
  revalidatePath("/givings/duplicates");
}
