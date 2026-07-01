"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, type AuthContext } from "@/lib/auth";
import { createAndValidateBatch, commitBatch, type ActorCtx } from "@/lib/imports/core";
import { getImportDef } from "@/lib/imports/registry";

export type ImportFormState = { error?: string };

function actorOf(ctx: AuthContext): ActorCtx {
  return {
    actorId: ctx.user.id,
    accessibleEntityIds: ctx.accessibleEntityIds,
    isSuperAdmin: ctx.isSuperAdmin,
  };
}

const canImport = (ctx: AuthContext) =>
  ctx.isSuperAdmin || ctx.roles.some((r) => r.role !== "auditor");

export async function uploadAndValidate(
  _prev: ImportFormState,
  formData: FormData
): Promise<ImportFormState> {
  const ctx = await requireUser();
  if (!canImport(ctx)) return { error: "You do not have permission to import data." };

  const importType = String(formData.get("import_type") || "");
  const def = getImportDef(importType);
  if (!def) return { error: "Choose a valid import type." };

  const entityId: string | null = String(formData.get("entity_id") || "") || null;
  if (def.entityScoped && !entityId)
    return { error: `${def.label} imports require an entity context.` };
  if (entityId && !ctx.isSuperAdmin && !ctx.accessibleEntityIds.includes(entityId))
    return { error: "You cannot import for that entity." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a spreadsheet file (.xlsx or .csv)." };
  if (file.size > 25 * 1024 * 1024) return { error: "File exceeds the 25MB limit." };

  let batchId: string;
  try {
    const buffer = await file.arrayBuffer();
    const res = await createAndValidateBatch({
      importType,
      entityId,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      buffer,
      actor: actorOf(ctx),
    });
    batchId = res.batchId;
  } catch (e) {
    return { error: (e as Error).message || "Failed to read the file." };
  }
  redirect(`/imports/${batchId}`);
}

export async function commitImport(formData: FormData): Promise<void> {
  const ctx = await requireUser();
  if (!canImport(ctx)) return;
  const batchId = String(formData.get("batch_id") || "");
  if (!batchId) return;
  await commitBatch(batchId, actorOf(ctx));
  revalidatePath(`/imports/${batchId}`);
  revalidatePath("/imports");
}
