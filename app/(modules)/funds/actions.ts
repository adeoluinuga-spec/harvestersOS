"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import {
  addAllowedUse,
  createInterFundLoan,
  createInvestment,
  createRestrictedFund,
  refreshMaturityAlerts,
  updateInvestmentStatus,
} from "@/lib/funds";

const FUND_ROLES = new Set([
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
    ctx.roles.some((r) => FUND_ROLES.has(r.role));
}

export async function createRestrictedFundAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect("/funds?error=permission");
  await withActor(ctx.user.id, (tx) =>
    createRestrictedFund(
      {
        entityId,
        name: String(formData.get("name") || "").trim(),
        classification: String(formData.get("fund_classification") || "temporarily_restricted"),
        targetAmount: String(formData.get("target_amount") || "0"),
        purpose: String(formData.get("purpose_description") || "").trim() || null,
      },
      tx
    )
  );
  revalidatePath("/funds");
  redirect("/funds?fund=created");
}

export async function addAllowedUseAction(formData: FormData) {
  const ctx = await requireUser();
  if (!ctx.roles.some((r) => FUND_ROLES.has(r.role))) redirect("/funds?error=permission");
  await withActor(ctx.user.id, (tx) =>
    addAllowedUse(
      String(formData.get("restricted_fund_id") || ""),
      String(formData.get("account_id") || ""),
      tx
    )
  );
  revalidatePath("/funds");
  redirect("/funds?allowed=added");
}

export async function createInterFundLoanAction(formData: FormData) {
  const ctx = await requireUser();
  const lendingEntityId = String(formData.get("lending_entity_id") || "");
  if (!canWrite(ctx, lendingEntityId)) redirect("/funds?error=permission");
  await withActor(ctx.user.id, (tx) =>
    createInterFundLoan(
      {
        lendingEntityId,
        lendingFund: String(formData.get("lending_fund") || "") || null,
        borrowingEntityId: String(formData.get("borrowing_entity_id") || ""),
        borrowingPurpose: String(formData.get("borrowing_purpose") || "").trim(),
        principalAmount: String(formData.get("principal_amount") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        dateIssued: String(formData.get("date_issued") || new Date().toISOString().slice(0, 10)),
        repaymentSchedule: String(formData.get("repayment_schedule") || "[]"),
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath("/funds");
  redirect("/funds?loan=created");
}

export async function createInvestmentAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect("/funds/investments?error=permission");
  await withActor(ctx.user.id, (tx) =>
    createInvestment(
      {
        entityId,
        investmentType: String(formData.get("investment_type") || "fixed_deposit"),
        institution: String(formData.get("institution") || "").trim(),
        principalAmount: String(formData.get("principal_amount") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        interestRate: String(formData.get("interest_rate") || "0"),
        startDate: String(formData.get("start_date") || ""),
        maturityDate: String(formData.get("maturity_date") || ""),
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath("/funds/investments");
  redirect("/funds/investments?investment=created");
}

export async function updateInvestmentStatusAction(formData: FormData) {
  const ctx = await requireUser();
  if (!ctx.roles.some((r) => FUND_ROLES.has(r.role))) redirect("/funds/investments?error=permission");
  await withActor(ctx.user.id, (tx) =>
    updateInvestmentStatus(
      String(formData.get("investment_id") || ""),
      String(formData.get("status") || "active"),
      String(formData.get("actual_return_amount") || "0"),
      tx
    )
  );
  revalidatePath("/funds/investments");
  redirect("/funds/investments?investment=updated");
}

export async function refreshInvestmentAlertsAction() {
  const ctx = await requireUser();
  if (!ctx.roles.some((r) => FUND_ROLES.has(r.role))) redirect("/funds/investments?error=permission");
  await withActor(ctx.user.id, (tx) => refreshMaturityAlerts(tx));
  revalidatePath("/funds/investments");
  redirect("/funds/investments?alerts=refreshed");
}
