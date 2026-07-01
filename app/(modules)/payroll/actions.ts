"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import {
  addCompensationComponent,
  approvePayrollRun,
  createHonorarium,
  createPayrollRun,
  createStaff,
  decideHonorarium,
  postHonorarium,
} from "@/lib/payroll";

const PAYROLL_ROLES = new Set([
  "super_admin",
  "finance_processor",
  "group_finance_officer",
  "sub_group_finance_officer",
  "campus_finance_officer",
  "cfo_coo",
]);

function canWrite(ctx: AuthContext, entityId?: string) {
  if (ctx.isSuperAdmin) return true;
  return Boolean(entityId && ctx.accessibleEntityIds.includes(entityId)) &&
    ctx.roles.some((r) => PAYROLL_ROLES.has(r.role));
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

export async function approvePayrollRunAction(formData: FormData) {
  const ctx = await requireUser();
  await withActor(ctx.user.id, (tx) =>
    approvePayrollRun(String(formData.get("payroll_run_id") || ""), ctx.user.id, tx)
  );
  revalidatePath("/payroll");
  redirect("/payroll?run=approved");
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
