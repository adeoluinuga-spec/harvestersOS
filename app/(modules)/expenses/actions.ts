"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import {
  createBatch as repoCreateBatch,
  createDisbursement as repoCreateDisbursement,
  createRequest as repoCreateRequest,
  createSignatureSlot as repoCreateSignatureSlot,
  createVendor as repoCreateVendor,
  decideApproval as repoDecideApproval,
  markDisbursed as repoMarkDisbursed,
  signDisbursement as repoSignDisbursement,
} from "@/lib/requisitions";

const WRITE_ROLES = new Set([
  "super_admin",
  "campus_admin",
  "campus_finance_officer",
  "sub_group_finance_officer",
  "group_finance_officer",
  "finance_processor",
  "ministry_lead",
  "head_of_expression",
  "ministry_director",
  "cfo_coo",
]);

function canWriteEntity(ctx: AuthContext, entityId: string) {
  if (ctx.isSuperAdmin) return true;
  return ctx.accessibleEntityIds.includes(entityId) && ctx.roles.some((r) => WRITE_ROLES.has(r.role));
}

function firstRole(ctx: AuthContext) {
  return ctx.roles.find((r) => r.role !== "auditor")?.role ?? "campus_admin";
}

export async function createVendorAction(formData: FormData) {
  const ctx = await requireUser();
  if (!ctx.roles.some((r) => WRITE_ROLES.has(r.role))) redirect("/expenses?denied=vendor");
  const name = String(formData.get("name") || "").trim();
  const account = String(formData.get("bank_account_number") || "").trim();
  if (!name || !account) redirect("/expenses/request?error=vendor");
  await withActor(ctx.user.id, (tx) =>
    repoCreateVendor(
      {
        name,
        account,
        taxId: String(formData.get("tax_id") || "").trim() || null,
        related: formData.get("is_related_party") === "on",
      },
      tx
    )
  );
  revalidatePath("/expenses/request");
  redirect("/expenses/request?vendor=created");
}

export async function createRequestAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!entityId || !canWriteEntity(ctx, entityId)) redirect("/expenses/request?error=permission");
  const amount = Number(String(formData.get("amount") || ""));
  if (!Number.isFinite(amount) || amount <= 0) redirect("/expenses/request?error=amount");
  await withActor(ctx.user.id, (tx) =>
    repoCreateRequest(
      {
        entityId,
        raisedBy: ctx.user.id,
        raisedByRole: firstRole(ctx),
        orgBranch: String(formData.get("org_branch") || "congregational"),
        raisedByLevel: String(formData.get("raised_by_level") || "campus"),
        vendorId: String(formData.get("vendor_id") || "") || null,
        category: String(formData.get("category") || "").trim(),
        description: String(formData.get("description") || "").trim(),
        amount: String(formData.get("amount") || ""),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        neededBy: String(formData.get("needed_by_date") || "") || null,
        urgent: formData.get("is_urgent") === "on",
        whtApplicable: formData.get("wht_applicable") === "on",
        whtRate: String(formData.get("wht_rate") || "0"),
      },
      tx
    )
  );
  revalidatePath("/expenses");
  revalidatePath("/expenses/track");
  redirect("/expenses/track?created=1");
}

export async function compileBatchAction(formData: FormData) {
  const ctx = await requireUser();
  const requestIds = formData.getAll("request_id").map(String).filter(Boolean);
  if (requestIds.length === 0) redirect("/expenses/compile?error=empty");
  await withActor(ctx.user.id, (tx) => repoCreateBatch({ requestIds, compiledBy: ctx.user.id }, tx));
  revalidatePath("/expenses/compile");
  revalidatePath("/expenses/approvals");
  redirect("/expenses/approvals?batch=submitted");
}

export async function decideApprovalAction(formData: FormData) {
  const ctx = await requireUser();
  const id = String(formData.get("approval_id") || "");
  const decision = String(formData.get("decision") || "approved") as "approved" | "rejected";
  await withActor(ctx.user.id, (tx) =>
    repoDecideApproval(id, ctx.user.id, decision, String(formData.get("comments") || "").trim() || null, tx)
  );
  revalidatePath("/expenses/approvals");
  revalidatePath("/expenses/finance");
  redirect("/expenses/approvals?decided=1");
}

export async function createDisbursementAction(formData: FormData) {
  const ctx = await requireUser();
  await withActor(ctx.user.id, (tx) =>
    repoCreateDisbursement(
      {
        subjectType: String(formData.get("subject_type") || ""),
        subjectId: String(formData.get("subject_id") || ""),
        bankAccountId: String(formData.get("bank_account_id") || ""),
        actor: ctx.user.id,
        uploadRef: String(formData.get("bank_upload_reference") || "").trim() || null,
        instructionRef: String(formData.get("transfer_instruction_reference") || "").trim() || null,
      },
      tx
    )
  );
  revalidatePath("/expenses/finance");
  revalidatePath("/expenses/signatures");
  redirect("/expenses/finance?sent=1");
}

export async function signDisbursementAction(formData: FormData) {
  const ctx = await requireUser();
  await withActor(ctx.user.id, (tx) =>
    repoSignDisbursement(
      {
        disbursementId: String(formData.get("disbursement_id") || ""),
        slotId: String(formData.get("slot_id") || ""),
        userId: ctx.user.id,
        method: String(formData.get("method") || "in_app_confirmation"),
        action: String(formData.get("action") || "approved"),
      },
      tx
    )
  );
  revalidatePath("/expenses/signatures");
  revalidatePath("/expenses/finance");
  redirect("/expenses/signatures?signed=1");
}

export async function markDisbursedAction(formData: FormData) {
  const ctx = await requireUser();
  await withActor(ctx.user.id, (tx) =>
    repoMarkDisbursed(String(formData.get("disbursement_id") || ""), ctx.user.id, tx)
  );
  revalidatePath("/expenses/finance");
  revalidatePath("/expenses/track");
  redirect("/expenses/finance?disbursed=1");
}

export async function createSignatureSlotAction(formData: FormData) {
  const ctx = await requireUser();
  if (!ctx.isSuperAdmin) redirect("/expenses/signature-admin?denied=1");
  await withActor(ctx.user.id, (tx) =>
    repoCreateSignatureSlot(
      {
        bankAccountId: String(formData.get("bank_account_id") || ""),
        label: String(formData.get("slot_label") || "").trim(),
        order: String(formData.get("slot_order") || "1"),
        requiresAll: formData.get("requires_all_members") === "on",
        memberIds: formData.getAll("member_id").map(String).filter(Boolean),
      },
      tx
    )
  );
  revalidatePath("/expenses/signature-admin");
  redirect("/expenses/signature-admin?saved=1");
}
