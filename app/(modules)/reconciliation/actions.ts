"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import {
  createCashCountSession,
  createCashDeposit,
  ingestBankFeedTransaction,
  manualMatch,
  runAutoMatch,
} from "@/lib/reconciliation";

const RECON_ROLES = new Set([
  "super_admin",
  "group_finance_officer",
  "sub_group_finance_officer",
  "campus_finance_officer",
  "campus_data_entry_clerk",
  "finance_processor",
  "campus_admin",
  "cfo_coo",
]);

function canWrite(ctx: AuthContext, entityId?: string) {
  if (ctx.isSuperAdmin) return true;
  return Boolean(entityId && ctx.accessibleEntityIds.includes(entityId)) &&
    ctx.roles.some((r) => RECON_ROLES.has(r.role));
}

const path = "/reconciliation";

export async function ingestBankFeedAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect(`${path}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    ingestBankFeedTransaction(
      {
        bankAccountId: String(formData.get("bank_account_id") || ""),
        provider: String(formData.get("provider") || "manual"),
        externalTransactionId: String(formData.get("external_transaction_id") || "").trim(),
        transactionDate: String(formData.get("transaction_date") || new Date().toISOString().slice(0, 10)),
        amount: String(formData.get("amount") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        description: String(formData.get("description") || "").trim() || null,
      },
      tx
    )
  );
  revalidatePath(path);
  redirect(`${path}?feed=ingested`);
}

export async function autoMatchAction(formData: FormData) {
  const ctx = await requireUser();
  if (!ctx.roles.some((r) => RECON_ROLES.has(r.role))) redirect(`${path}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    runAutoMatch(String(formData.get("bank_account_id") || "") || null, tx)
  );
  revalidatePath(path);
  redirect(`${path}?match=auto`);
}

export async function manualMatchAction(formData: FormData) {
  const ctx = await requireUser();
  if (!ctx.roles.some((r) => RECON_ROLES.has(r.role))) redirect(`${path}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    manualMatch(
      {
        bankFeedTransactionId: String(formData.get("bank_feed_transaction_id") || ""),
        journalEntryLineId: String(formData.get("journal_entry_line_id") || ""),
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath(path);
  redirect(`${path}?match=manual`);
}

export async function createCashCountAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect(`${path}?error=permission`);
  const secondCounter = String(formData.get("second_counter_id") || "");
  if (!secondCounter || secondCounter === ctx.user.id) redirect(`${path}?error=dual_counter`);
  await withActor(ctx.user.id, (tx) =>
    createCashCountSession(
      {
        entityId,
        serviceDate: String(formData.get("service_date") || new Date().toISOString().slice(0, 10)),
        countedBy: [ctx.user.id, secondCounter],
        totalCounted: String(formData.get("total_counted") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        sealedBagReference: String(formData.get("sealed_bag_reference") || "").trim(),
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath(path);
  redirect(`${path}?cash=counted`);
}

export async function createCashDepositAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect(`${path}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    createCashDeposit(
      {
        cashCountSessionId: String(formData.get("cash_count_session_id") || ""),
        depositedAmount: String(formData.get("deposited_amount") || "0"),
        bankAccountId: String(formData.get("bank_account_id") || ""),
        depositDate: String(formData.get("deposit_date") || new Date().toISOString().slice(0, 10)),
        depositSlipReference: String(formData.get("deposit_slip_reference") || "").trim(),
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath(path);
  redirect(`${path}?cash=deposited`);
}
