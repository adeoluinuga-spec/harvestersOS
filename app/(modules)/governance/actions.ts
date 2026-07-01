"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import {
  createConflictOfInterest,
  createWhistleblowerReport,
  reviewConflictOfInterest,
  updateWhistleblowerStatus,
  upsertScumlLog,
} from "@/lib/governance";

const GOVERNANCE_ROLES = new Set([
  "super_admin",
  "auditor",
  "governance_officer",
  "board_trustee",
  "cfo_coo",
  "global_lead_pastor",
]);

function canGovern(ctx: AuthContext) {
  return ctx.roles.some((r) => GOVERNANCE_ROLES.has(r.role));
}

const path = "/governance";

export async function upsertScumlAction(formData: FormData) {
  const ctx = await requireUser();
  if (!canGovern(ctx)) redirect(`${path}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    upsertScumlLog(
      {
        entityId: String(formData.get("entity_id") || ""),
        registrationStatus: String(formData.get("registration_status") || "pending_registration"),
        registrationNumber: String(formData.get("registration_number") || "").trim() || null,
        registrationDate: String(formData.get("registration_date") || "") || null,
        lastFilingDate: String(formData.get("last_filing_date") || "") || null,
        nextFilingDueDate: String(formData.get("next_filing_due_date") || "") || null,
        notes: String(formData.get("notes") || "").trim() || null,
        reviewer: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath(path);
  redirect(`${path}?scuml=saved`);
}

export async function createConflictAction(formData: FormData) {
  const ctx = await requireUser();
  if (!canGovern(ctx)) redirect(`${path}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    createConflictOfInterest(
      {
        trusteeId: String(formData.get("trustee_id") || "") || null,
        staffId: String(formData.get("staff_id") || "") || null,
        declaredInterest: String(formData.get("declared_interest") || "").trim(),
        dateDeclared: String(formData.get("date_declared") || new Date().toISOString().slice(0, 10)),
      },
      tx
    )
  );
  revalidatePath(path);
  redirect(`${path}?conflict=created`);
}

export async function reviewConflictAction(formData: FormData) {
  const ctx = await requireUser();
  if (!canGovern(ctx)) redirect(`${path}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    reviewConflictOfInterest(
      String(formData.get("conflict_id") || ""),
      ctx.user.id,
      String(formData.get("status") || "reviewed"),
      tx
    )
  );
  revalidatePath(path);
  redirect(`${path}?conflict=reviewed`);
}

export async function createWhistleblowerAction(formData: FormData) {
  const ctx = await requireUser();
  const anonymous = formData.get("is_anonymous") === "on";
  await withActor(ctx.user.id, (tx) =>
    createWhistleblowerReport(
      {
        anonymous,
        reporterUserId: anonymous ? null : ctx.user.id,
        reporterContact: String(formData.get("reporter_contact") || "").trim() || null,
        category: String(formData.get("category") || "other"),
        description: String(formData.get("description") || "").trim(),
      },
      tx
    )
  );
  revalidatePath(path);
  redirect(`${path}?whistleblower=submitted`);
}

export async function updateWhistleblowerAction(formData: FormData) {
  const ctx = await requireUser();
  if (!canGovern(ctx)) redirect(`${path}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    updateWhistleblowerStatus(
      String(formData.get("report_id") || ""),
      String(formData.get("status") || "under_review"),
      ctx.user.id,
      String(formData.get("resolution_note") || "").trim() || null,
      tx
    )
  );
  revalidatePath(path);
  redirect(`${path}?whistleblower=updated`);
}
