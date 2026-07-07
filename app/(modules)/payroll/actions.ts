"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import {
  addAdjustment,
  addCompensationComponent,
  approvePayrollRun,
  createHonorarium,
  createPayrollRun,
  createStaff,
  createSupplementaryBatch,
  decideHonorarium,
  deleteAdjustment,
  disburseBatch,
  markBatchUploaded,
  markPayment,
  postHonorarium,
  reissuePayment,
  rejectPayrollRun,
  signBatch,
  submitPayrollRun,
} from "@/lib/payroll";
import { attachDocument } from "@/lib/documents";

// Preparers: HR + finance cadres. Approval is the pastor/head's alone.
const PAYROLL_ROLES = new Set([
  "super_admin",
  "hr_officer",
  "finance_processor",
  "group_finance_officer",
  "sub_group_finance_officer",
  "campus_finance_officer",
  "cfo_coo",
]);

const APPROVER_ROLES = new Set([
  "super_admin",
  "campus_pastor",
  "sub_group_pastor",
  "group_pastor",
  "global_lead_pastor",
  "ministry_lead",
  "head_of_expression",
  "cfo_coo",
]);

function canWrite(ctx: AuthContext, entityId?: string) {
  if (ctx.isSuperAdmin) return true;
  return Boolean(entityId && ctx.accessibleEntityIds.includes(entityId)) &&
    ctx.roles.some((r) => PAYROLL_ROLES.has(r.role));
}

function canApprove(ctx: AuthContext, entityId?: string) {
  if (ctx.isSuperAdmin) return true;
  return Boolean(entityId && ctx.accessibleEntityIds.includes(entityId)) &&
    ctx.roles.some((r) => APPROVER_ROLES.has(r.role));
}

export async function createStaffAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect("/payroll?error=permission");
  await withActor(ctx.user.id, (tx) =>
    createStaff(
      {
        entityId,
        fullName: String(formData.get("full_name") || "").trim(),
        staffType: String(formData.get("staff_type") || "administrative"),
        employmentStatus: String(formData.get("employment_status") || "employed"),
        state: String(formData.get("state_of_taxation") || "").trim() || "default",
        pfaProvider: String(formData.get("pfa_provider") || "").trim() || null,
        pensionId: String(formData.get("pension_id") || "").trim() || null,
      },
      tx
    )
  );
  revalidatePath("/payroll");
  redirect("/payroll?staff=created");
}

export async function addComponentAction(formData: FormData) {
  const ctx = await requireUser();
  if (!ctx.roles.some((r) => PAYROLL_ROLES.has(r.role))) redirect("/payroll?error=permission");
  await withActor(ctx.user.id, (tx) =>
    addCompensationComponent(
      {
        staffId: String(formData.get("staff_id") || ""),
        componentType: String(formData.get("component_type") || "base_salary"),
        amount: String(formData.get("amount") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        taxable: formData.get("is_taxable") === "on",
      },
      tx
    )
  );
  revalidatePath("/payroll");
  redirect("/payroll?component=added");
}

export async function createPayrollRunAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect("/payroll?error=permission");
  await withActor(ctx.user.id, (tx) =>
    createPayrollRun(
      {
        entityId,
        month: String(formData.get("period_month") || ""),
        year: String(formData.get("period_year") || ""),
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath("/payroll");
  redirect("/payroll?run=created");
}

export async function submitPayrollRunAction(formData: FormData) {
  const ctx = await requireUser();
  const runId = String(formData.get("payroll_run_id") || "");
  const entityId = String(formData.get("entity_id") || "");
  const back = String(formData.get("back") || "/payroll");
  if (!canWrite(ctx, entityId)) redirect(`${back}?error=permission`);
  // Supporting document (approval memo / schedule) travels with the run.
  const file = formData.get("document_file");
  await withActor(ctx.user.id, (tx) => submitPayrollRun(runId, ctx.user.id, tx));
  if (file instanceof File && file.size > 0) {
    try {
      await withActor(ctx.user.id, (tx) =>
        attachDocument(
          { subjectType: "payroll_run", subjectId: runId, entityId, file, actorId: ctx.user.id },
          tx
        )
      );
    } catch { /* run stands; re-attach later */ }
  }
  revalidatePath("/payroll");
  redirect(`${back}?run=submitted`);
}

export async function approvePayrollRunAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  const back = String(formData.get("back") || "/payroll");
  if (!canApprove(ctx, entityId)) redirect(`${back}?error=permission`);
  try {
    await withActor(ctx.user.id, (tx) =>
      approvePayrollRun(String(formData.get("payroll_run_id") || ""), ctx.user.id, tx)
    );
  } catch (e) {
    redirect(`${back}?error=${encodeURIComponent((e as Error).message)}`);
  }
  revalidatePath("/payroll");
  redirect(`${back}?run=approved`);
}

export async function rejectPayrollRunAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  const back = String(formData.get("back") || "/payroll");
  if (!canApprove(ctx, entityId)) redirect(`${back}?error=permission`);
  const reason = String(formData.get("reason") || "").trim();
  if (!reason) redirect(`${back}?error=${encodeURIComponent("A rejection reason is required")}`);
  await withActor(ctx.user.id, (tx) =>
    rejectPayrollRun(String(formData.get("payroll_run_id") || ""), ctx.user.id, reason, tx)
  );
  revalidatePath("/payroll");
  redirect(`${back}?run=rejected`);
}

// --- Adjustments (HR calculator) -------------------------------------------
export async function addAdjustmentAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  const back = String(formData.get("back") || "/payroll");
  if (!canWrite(ctx, entityId)) redirect(`${back}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    addAdjustment(
      {
        staffId: String(formData.get("staff_id") || ""),
        month: Number(formData.get("period_month") || 0),
        year: Number(formData.get("period_year") || 0),
        kind: (String(formData.get("kind") || "deduction") === "earning" ? "earning" : "deduction"),
        label: String(formData.get("label") || "").trim(),
        amount: String(formData.get("amount") || "0"),
        taxable: formData.get("is_taxable") === "on",
        note: String(formData.get("note") || "").trim() || null,
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath(back);
  redirect(`${back}?adjustment=added`);
}

export async function deleteAdjustmentAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  const back = String(formData.get("back") || "/payroll");
  if (!canWrite(ctx, entityId)) redirect(`${back}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    deleteAdjustment(String(formData.get("id") || ""), tx)
  );
  revalidatePath(back);
  redirect(back);
}

// --- Batches: upload → sign → disburse; payment outcomes --------------------
export async function markBatchUploadedAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect("/payroll/payments?error=permission");
  await withActor(ctx.user.id, (tx) =>
    markBatchUploaded(
      {
        batchId: String(formData.get("batch_id") || ""),
        bankAccountId: String(formData.get("bank_account_id") || ""),
        uploadRef: String(formData.get("bank_upload_reference") || "").trim(),
        instructionRef: String(formData.get("transfer_instruction_reference") || "").trim(),
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath("/payroll/payments");
  redirect("/payroll/payments?batch=uploaded");
}

export async function signBatchAction(formData: FormData) {
  const ctx = await requireUser();
  try {
    await withActor(ctx.user.id, (tx) =>
      signBatch(String(formData.get("batch_id") || ""), ctx.user.id, tx)
    );
  } catch (e) {
    redirect(`/payroll/payments?error=${encodeURIComponent((e as Error).message)}`);
  }
  revalidatePath("/payroll/payments");
  redirect("/payroll/payments?batch=signed");
}

export async function disburseBatchAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect("/payroll/payments?error=permission");
  await withActor(ctx.user.id, (tx) =>
    disburseBatch(String(formData.get("batch_id") || ""), ctx.user.id, tx)
  );
  revalidatePath("/payroll/payments");
  redirect("/payroll/payments?batch=disbursed");
}

export async function markPaymentAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  const back = String(formData.get("back") || "/payroll/payments");
  if (!canWrite(ctx, entityId)) redirect(`${back}?error=permission`);
  const status = String(formData.get("status") || "");
  if (!["successful", "returned", "contested"].includes(status)) redirect(back);
  await withActor(ctx.user.id, (tx) =>
    markPayment(
      {
        paymentId: String(formData.get("payment_id") || ""),
        status: status as "successful" | "returned" | "contested",
        note: String(formData.get("note") || "").trim() || null,
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath(back);
  redirect(back);
}

export async function reissuePaymentAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  const back = String(formData.get("back") || "/payroll/payments");
  if (!canWrite(ctx, entityId)) redirect(`${back}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    reissuePayment(String(formData.get("payment_id") || ""), ctx.user.id, tx)
  );
  revalidatePath(back);
  redirect(`${back}?payment=reissued`);
}

export async function createSupplementaryBatchAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect("/payroll/payments?error=permission");
  try {
    await withActor(ctx.user.id, (tx) =>
      createSupplementaryBatch(
        entityId,
        String(formData.get("planned_date") || new Date().toISOString().slice(0, 10)),
        ctx.user.id,
        tx
      )
    );
  } catch (e) {
    redirect(`/payroll/payments?error=${encodeURIComponent((e as Error).message)}`);
  }
  revalidatePath("/payroll/payments");
  redirect("/payroll/payments?batch=created");
}

export async function createHonorariumAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect("/payroll/honorariums?error=permission");
  await withActor(ctx.user.id, (tx) =>
    createHonorarium(
      {
        entityId,
        recipientName: String(formData.get("recipient_name") || "").trim(),
        recipientType: String(formData.get("recipient_type") || "guest_minister"),
        amount: String(formData.get("amount") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        eventId: String(formData.get("event_id") || "") || null,
        whtApplicable: formData.get("wht_applicable") === "on",
        whtAmount: String(formData.get("wht_amount") || "0"),
        paymentDate: String(formData.get("payment_date") || new Date().toISOString().slice(0, 10)),
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath("/payroll/honorariums");
  redirect("/payroll/honorariums?honorarium=created");
}

export async function decideHonorariumAction(formData: FormData) {
  const ctx = await requireUser();
  await withActor(ctx.user.id, (tx) =>
    decideHonorarium(
      String(formData.get("approval_id") || ""),
      ctx.user.id,
      String(formData.get("decision") || "approved") as "approved" | "rejected",
      String(formData.get("comments") || "").trim() || null,
      tx
    )
  );
  revalidatePath("/payroll/honorariums");
  redirect("/payroll/honorariums?decided=1");
}

export async function postHonorariumAction(formData: FormData) {
  const ctx = await requireUser();
  await withActor(ctx.user.id, (tx) =>
    postHonorarium(String(formData.get("honorarium_id") || ""), ctx.user.id, tx)
  );
  revalidatePath("/payroll/honorariums");
  redirect("/payroll/honorariums?paid=1");
}
