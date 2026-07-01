"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import {
  createBudgetCycle,
  reviewBudgetLine,
  setEntityBudgetMode,
  submitBudgetLine,
  updateBudgetCycleStatus,
} from "@/lib/budgeting";

const BUDGET_ROLES = new Set([
  "super_admin",
  "campus_admin",
  "campus_finance_officer",
  "sub_group_finance_officer",
  "group_finance_officer",
  "finance_processor",
  "cfo_coo",
]);

function canWrite(ctx: AuthContext, entityId?: string) {
  if (ctx.isSuperAdmin) return true;
  return Boolean(entityId && ctx.accessibleEntityIds.includes(entityId)) &&
    ctx.roles.some((r) => BUDGET_ROLES.has(r.role));
}

export async function createBudgetCycleAction(formData: FormData) {
  const ctx = await requireUser();
  if (!ctx.isSuperAdmin) redirect("/budgeting?error=permission");
  await withActor(ctx.user.id, (tx) =>
    createBudgetCycle(String(formData.get("fiscal_year") || ""), tx)
  );
  revalidatePath("/budgeting");
  redirect("/budgeting?cycle=created");
}

export async function updateBudgetCycleStatusAction(formData: FormData) {
  const ctx = await requireUser();
  if (!ctx.isSuperAdmin) redirect("/budgeting?error=permission");
  await withActor(ctx.user.id, (tx) =>
    updateBudgetCycleStatus(
      String(formData.get("budget_cycle_id") || ""),
      String(formData.get("status") || "open_for_submission"),
      tx
    )
  );
  revalidatePath("/budgeting");
  redirect("/budgeting?cycle=updated");
}

export async function submitBudgetLineAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect("/budgeting?error=permission");
  await withActor(ctx.user.id, (tx) =>
    submitBudgetLine(
      {
        cycleId: String(formData.get("budget_cycle_id") || ""),
        entityId,
        accountId: String(formData.get("account_id") || ""),
        proposedAmount: String(formData.get("proposed_amount") || "0"),
        submittedBy: ctx.user.id,
        notes: String(formData.get("notes") || "").trim() || null,
        priorLineId: String(formData.get("prior_budget_line_id") || "") || null,
      },
      tx
    )
  );
  revalidatePath("/budgeting");
  redirect("/budgeting?line=submitted");
}

export async function reviewBudgetLineAction(formData: FormData) {
  const ctx = await requireUser();
  await withActor(ctx.user.id, (tx) =>
    reviewBudgetLine(
      String(formData.get("budget_line_id") || ""),
      String(formData.get("approved_amount") || "0"),
      String(formData.get("review_justification") || "").trim(),
      ctx.user.id,
      tx
    )
  );
  revalidatePath("/budgeting");
  redirect("/budgeting?line=reviewed");
}

export async function setBudgetModeAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect("/budgeting?error=permission");
  await withActor(ctx.user.id, (tx) =>
    setEntityBudgetMode(entityId, String(formData.get("enforcement_mode") || "warn"), tx)
  );
  revalidatePath("/budgeting");
  redirect("/budgeting?mode=saved");
}
