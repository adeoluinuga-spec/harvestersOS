"use server";

import { revalidatePath } from "next/cache";
import { insertAccount, insertEntity } from "@/lib/repo";
import { humanize } from "@/lib/enums";

export type FormState = { ok?: boolean; error?: string; message?: string };

export async function createEntity(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const type = String(formData.get("type") || "");
  const name = String(formData.get("name") || "").trim();
  const parent = String(formData.get("parent_entity_id") || "") || null;
  const country = String(formData.get("country") || "").trim().toUpperCase() || null;
  const currency = String(formData.get("functional_currency") || "")
    .trim()
    .toUpperCase();
  const legal = String(formData.get("legal_status") || "") || null;
  const start = String(formData.get("start_date") || "") || null;
  const end = String(formData.get("end_date") || "") || null;

  if (!type) return { error: "Entity type is required." };
  if (!name) return { error: "Name is required." };
  if (currency.length !== 3)
    return { error: "Functional currency must be a 3-letter ISO code (e.g. NGN)." };
  if (type !== "group" && !parent)
    return { error: "A parent entity is required for everything except the top-level Group." };
  if (type === "event" && (!start || !end))
    return { error: "Events require both a start and end date." };
  if (start && end && end < start)
    return { error: "End date cannot be before start date." };

  try {
    await insertEntity({
      type,
      name,
      parent_entity_id: parent,
      country,
      functional_currency: currency,
      legal_status: legal,
      start_date: start,
      end_date: end,
    });
  } catch (e) {
    return { error: (e as Error).message || "Failed to create entity." };
  }

  revalidatePath("/admin/entities");
  return { ok: true, message: `Created ${humanize(type)} “${name}”.` };
}

export async function createAccount(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const code = String(formData.get("code") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const account_type = String(formData.get("account_type") || "");
  const fund_classification = String(formData.get("fund_classification") || "");

  if (!code) return { error: "Account code is required." };
  if (!name) return { error: "Account name is required." };
  if (!account_type) return { error: "Account type is required." };
  if (!fund_classification) return { error: "Fund classification is required." };

  try {
    await insertAccount({ code, name, account_type, fund_classification });
  } catch (e) {
    const msg = (e as Error).message || "";
    if (msg.includes("duplicate") || msg.includes("unique"))
      return { error: `Account code “${code}” already exists.` };
    return { error: msg || "Failed to create account." };
  }

  revalidatePath("/admin/accounts");
  return { ok: true, message: `Created account ${code} — ${name}.` };
}
