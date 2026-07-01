"use server";

import { revalidatePath } from "next/cache";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import { parseSelection } from "@/lib/bulk";
import { deactivateGivers, giverIdsMatching } from "@/lib/givings";

const FINANCE = ["group_finance_officer", "sub_group_finance_officer", "campus_finance_officer"];
const canManage = (ctx: AuthContext) =>
  ctx.isSuperAdmin || ctx.roles.some((r) => FINANCE.includes(r.role));

/** Server-side bulk mutations (currently: deactivate — never a hard delete). */
export async function bulkGivers(formData: FormData): Promise<void> {
  const ctx = await requireUser();
  if (!canManage(ctx)) return;
  const { ids, allMatching, filter, actionKey } = parseSelection(formData);
  const target = allMatching ? await giverIdsMatching(filter.q ?? "") : ids;
  if (target.length === 0) return;

  if (actionKey === "deactivate") {
    await withActor(ctx.user.id, (tx) => deactivateGivers(target, tx));
  }
  revalidatePath("/givings/givers");
}
