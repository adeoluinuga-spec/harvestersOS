"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import {
  addFxRate,
  createCrossBorderTransfer,
  documentCrossBorderTransfer,
} from "@/lib/international";

const INTERNATIONAL_ROLES = new Set([
  "super_admin",
  "group_finance_officer",
  "group_pastor",
  "global_lead_pastor",
  "cfo_coo",
  "finance_processor",
]);

const GROUP_APPROVAL_ROLES = new Set([
  "super_admin",
  "group_finance_officer",
  "group_pastor",
  "global_lead_pastor",
  "cfo_coo",
]);

function canAccessEither(ctx: AuthContext, a: string, b: string) {
  if (ctx.isSuperAdmin) return true;
  return ctx.accessibleEntityIds.includes(a) || ctx.accessibleEntityIds.includes(b);
}

function canRequest(ctx: AuthContext, a: string, b: string) {
  return canAccessEither(ctx, a, b) && ctx.roles.some((r) => INTERNATIONAL_ROLES.has(r.role));
}

function canGroupApprove(ctx: AuthContext) {
  return ctx.roles.some((r) => GROUP_APPROVAL_ROLES.has(r.role));
}

const path = "/international";

export async function addFxRateAction(formData: FormData) {
  const ctx = await requireUser();
  if (!canGroupApprove(ctx)) redirect(`${path}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    addFxRate(
      {
        currencyPair: String(formData.get("currency_pair") || "").trim().toUpperCase(),
        rate: String(formData.get("rate") || "0"),
        effectiveDate: String(formData.get("effective_date") || new Date().toISOString().slice(0, 10)),
        source: String(formData.get("source") || "").trim() || "manual",
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath(path);
  redirect(`${path}?fx=added`);
}

export async function createCrossBorderTransferAction(formData: FormData) {
  const ctx = await requireUser();
  const sendingEntityId = String(formData.get("sending_entity_id") || "");
  const receivingEntityId = String(formData.get("receiving_entity_id") || "");
  if (!canRequest(ctx, sendingEntityId, receivingEntityId)) redirect(`${path}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    createCrossBorderTransfer(
      {
        sendingEntityId,
        receivingEntityId,
        direction: String(formData.get("direction") || "hq_to_international"),
        purpose: String(formData.get("purpose") || "other"),
        amount: String(formData.get("amount") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        documentationUrl: String(formData.get("supporting_documentation_url") || "").trim() || null,
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath(path);
  redirect(`${path}?transfer=requested`);
}

export async function documentCrossBorderTransferAction(formData: FormData) {
  const ctx = await requireUser();
  if (!canGroupApprove(ctx)) redirect(`${path}?error=permission`);
  const documentationUrl = String(formData.get("supporting_documentation_url") || "").trim();
  if (!documentationUrl) redirect(`${path}?error=documentation_required`);
  await withActor(ctx.user.id, (tx) =>
    documentCrossBorderTransfer(
      {
        transferId: String(formData.get("transfer_id") || ""),
        documentationUrl,
        status: String(formData.get("compliance_status") || "documented"),
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath(path);
  redirect(`${path}?transfer=documented`);
}
