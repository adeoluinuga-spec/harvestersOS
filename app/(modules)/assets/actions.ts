"use server";

import { revalidatePath } from "next/cache";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import { capitalizeAsset, disposeAsset, runDepreciation } from "@/lib/fixedAssets";

export type AssetFormState = { ok?: boolean; error?: string; message?: string };

const ASSET_ROLES = new Set([
  "super_admin",
  "cfo_coo",
  "group_finance_officer",
  "sub_group_finance_officer",
  "campus_finance_officer",
]);

function canManage(ctx: AuthContext, entityId?: string) {
  if (ctx.isSuperAdmin) return true;
  if (!ctx.roles.some((r) => ASSET_ROLES.has(r.role))) return false;
  return entityId ? ctx.accessibleEntityIds.includes(entityId) : true;
}

export async function capitalizeAssetAction(
  _prev: AssetFormState,
  formData: FormData
): Promise<AssetFormState> {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!entityId) return { error: "Select the owning entity." };
  if (!canManage(ctx, entityId))
    return { error: "You do not have permission to capitalize assets for this entity." };

  const name = String(formData.get("name") || "").trim();
  const category = String(formData.get("category") || "other");
  const acquisitionDate = String(formData.get("acquisition_date") || "");
  const cost = String(formData.get("cost") || "");
  const salvage = String(formData.get("salvage_value") || "0") || "0";
  const lifeMonths = Number(formData.get("useful_life_months") || 0);
  const funding = formData.get("funding") === "opening" ? ("opening" as const) : ("bank" as const);

  if (!name) return { error: "Enter the asset name." };
  if (!acquisitionDate) return { error: "Select the acquisition date." };
  if (!(Number(cost) > 0)) return { error: "Enter a valid cost." };
  if (!Number.isInteger(lifeMonths) || lifeMonths <= 0)
    return { error: "Enter the useful life in months (e.g. 60 for 5 years)." };
  if (Number(salvage) < 0 || Number(salvage) > Number(cost))
    return { error: "Salvage value must be between 0 and the cost." };

  try {
    await withActor(ctx.user.id, (tx) =>
      capitalizeAsset(
        { entityId, name, category, acquisitionDate, cost, salvage, lifeMonths, funding, actor: ctx.user.id },
        tx
      )
    );
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/assets");
  return { ok: true, message: `Capitalized “${name}” and posted it to the ledger.` };
}

export async function runDepreciationAction(
  _prev: AssetFormState,
  formData: FormData
): Promise<AssetFormState> {
  const ctx = await requireUser();
  if (!canManage(ctx)) return { error: "You do not have permission to run depreciation." };
  const period = String(formData.get("period") || "") || null;
  try {
    const res = await withActor(ctx.user.id, (tx) =>
      runDepreciation(period ? `${period}-01` : null, ctx.user.id, tx)
    );
    revalidatePath("/assets");
    return {
      ok: true,
      message: `Depreciation ${res.period}: ${res.assets_depreciated} asset(s), ${res.entries_posted} entr(ies) posted, total ${Number(res.total_amount).toLocaleString()}.`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function disposeAssetAction(
  _prev: AssetFormState,
  formData: FormData
): Promise<AssetFormState> {
  const ctx = await requireUser();
  const assetId = String(formData.get("asset_id") || "");
  const entityId = String(formData.get("entity_id") || "");
  if (!assetId) return { error: "Missing asset." };
  if (!canManage(ctx, entityId || undefined))
    return { error: "You do not have permission to dispose this asset." };
  const disposalDate = String(formData.get("disposal_date") || "") || new Date().toISOString().slice(0, 10);
  const proceeds = String(formData.get("proceeds") || "0") || "0";
  try {
    await withActor(ctx.user.id, (tx) =>
      disposeAsset({ assetId, disposalDate, proceeds, actor: ctx.user.id }, tx)
    );
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/assets");
  return { ok: true, message: "Asset disposed; gain/loss posted to the ledger." };
}
