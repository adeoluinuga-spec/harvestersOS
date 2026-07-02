"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  generateWeeklyIncomeReport,
  lastCompletedWeek,
  reportScope,
  sendWeeklyReportsToSubgroup,
} from "@/lib/weeklyIncomeReports";

export async function generateCampusWeeklyReportAction(formData: FormData) {
  const ctx = await requireUser();
  const campusId = String(formData.get("campus_id") || "");
  const weekStart = String(formData.get("week_start") || "");
  const weekEnd = String(formData.get("week_end") || "");
  if (!campusId) redirect("/reports/weekly?error=campus");
  if (!ctx.isSuperAdmin && !ctx.isAuditor && !ctx.accessibleEntityIds.includes(campusId)) {
    redirect("/reports/weekly?error=permission");
  }
  const period = weekStart && weekEnd ? { weekStart, weekEnd } : lastCompletedWeek();
  const id = await generateWeeklyIncomeReport({
    campusId,
    weekStart: period.weekStart,
    weekEnd: period.weekEnd,
    actorId: ctx.user.id,
    send: false,
  });
  revalidatePath("/");
  revalidatePath("/reports/weekly");
  redirect(`/reports/weekly/${id}`);
}

export async function sendSubgroupWeeklyReportsAction(formData: FormData) {
  const ctx = await requireUser();
  const subgroupId = String(formData.get("subgroup_id") || "");
  const weekStart = String(formData.get("week_start") || "");
  const weekEnd = String(formData.get("week_end") || "");
  if (!subgroupId) redirect("/reports/weekly?error=subgroup");
  const period = weekStart && weekEnd ? { weekStart, weekEnd } : lastCompletedWeek();
  const result = await sendWeeklyReportsToSubgroup({
    subgroupId,
    weekStart: period.weekStart,
    weekEnd: period.weekEnd,
    actorId: ctx.user.id,
    scope: reportScope(ctx),
  });
  revalidatePath("/");
  revalidatePath("/reports/weekly");
  redirect(`/reports/weekly?sent=${result.count}`);
}
