"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import { createEvent } from "@/lib/events";
import {
  createCommitment,
  createDigitalProduct,
  createDigitalProductSale,
  createPartner,
  createPartnershipTier,
  detectPartnerLapses,
  recordPartnershipPayment,
} from "@/lib/nextLevelPrayers";
import { createHonorarium } from "@/lib/payroll";

const NLP_ROLES = new Set([
  "super_admin",
  "head_of_expression",
  "ministry_director",
  "ministry_lead",
  "finance_processor",
  "group_finance_officer",
  "cfo_coo",
  "campus_data_entry_clerk",
]);

function canWrite(ctx: AuthContext, entityId?: string) {
  if (ctx.isSuperAdmin) return true;
  return Boolean(entityId && ctx.accessibleEntityIds.includes(entityId)) &&
    ctx.roles.some((r) => NLP_ROLES.has(r.role));
}

const nlpPath = "/next-level-prayers";

export async function createTierAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect(`${nlpPath}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    createPartnershipTier(
      {
        entityId,
        name: String(formData.get("name") || "").trim(),
        minMonthlyAmount: String(formData.get("min_monthly_amount") || "0"),
        maxMonthlyAmount: String(formData.get("max_monthly_amount") || "") || null,
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        sortOrder: String(formData.get("sort_order") || "0"),
      },
      tx
    )
  );
  revalidatePath(nlpPath);
  redirect(`${nlpPath}?tier=saved`);
}

export async function createPartnerAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect(`${nlpPath}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    createPartner(
      {
        entityId,
        giverId: String(formData.get("giver_id") || ""),
        tierId: String(formData.get("partnership_tier_id") || "") || null,
        startDate: String(formData.get("start_date") || new Date().toISOString().slice(0, 10)),
        status: String(formData.get("status") || "active"),
      },
      tx
    )
  );
  revalidatePath(nlpPath);
  redirect(`${nlpPath}?partner=saved`);
}

export async function createCommitmentAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect(`${nlpPath}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    createCommitment(
      {
        partnerId: String(formData.get("partner_id") || ""),
        committedMonthlyAmount: String(formData.get("committed_monthly_amount") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        startMonth: String(formData.get("start_month") || new Date().toISOString().slice(0, 10)),
        expectedDay: String(formData.get("expected_day") || "1"),
      },
      tx
    )
  );
  revalidatePath(nlpPath);
  redirect(`${nlpPath}?commitment=saved`);
}

export async function recordPartnershipPaymentAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect(`${nlpPath}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    recordPartnershipPayment(
      {
        commitmentId: String(formData.get("commitment_id") || ""),
        amount: String(formData.get("amount") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        channel: String(formData.get("channel") || "bank_transfer"),
        transactionDate: String(formData.get("transaction_date") || new Date().toISOString().slice(0, 10)),
        actor: ctx.user.id,
        note: String(formData.get("note") || "").trim() || null,
      },
      tx
    )
  );
  revalidatePath(nlpPath);
  redirect(`${nlpPath}?payment=recorded`);
}

export async function detectLapsesAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect(`${nlpPath}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    detectPartnerLapses(String(formData.get("as_of") || new Date().toISOString().slice(0, 10)), tx)
  );
  revalidatePath(nlpPath);
  redirect(`${nlpPath}?lapses=checked`);
}

export async function createNlpProgramAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect(`${nlpPath}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    createEvent(
      {
        eventName: String(formData.get("event_name") || "").trim(),
        eventType: String(formData.get("event_type") || "prayer_conference"),
        hostingEntityId: entityId,
        startDate: String(formData.get("start_date") || ""),
        endDate: String(formData.get("end_date") || ""),
        attendeeCount: String(formData.get("attendee_count") || "0"),
        status: String(formData.get("status") || "planning"),
      },
      tx
    )
  );
  revalidatePath(nlpPath);
  revalidatePath("/events");
  redirect(`${nlpPath}?program=created`);
}

export async function createDigitalProductAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect(`${nlpPath}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    createDigitalProduct(
      {
        entityId,
        name: String(formData.get("name") || "").trim(),
        productType: String(formData.get("product_type") || "course"),
        accessPeriodDays: String(formData.get("access_period_days") || "30"),
        priceAmount: String(formData.get("price_amount") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
      },
      tx
    )
  );
  revalidatePath(nlpPath);
  redirect(`${nlpPath}?product=saved`);
}

export async function createDigitalSaleAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect(`${nlpPath}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    createDigitalProductSale(
      {
        productId: String(formData.get("digital_product_id") || ""),
        giverId: String(formData.get("giver_id") || "") || null,
        saleDate: String(formData.get("sale_date") || new Date().toISOString().slice(0, 10)),
        amount: String(formData.get("amount") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        accessStartDate: String(formData.get("access_start_date") || new Date().toISOString().slice(0, 10)),
        accessEndDate: String(formData.get("access_end_date") || new Date().toISOString().slice(0, 10)),
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath(nlpPath);
  redirect(`${nlpPath}?sale=recorded`);
}

export async function createIntercessorHonorariumAction(formData: FormData) {
  const ctx = await requireUser();
  const entityId = String(formData.get("entity_id") || "");
  if (!canWrite(ctx, entityId)) redirect(`${nlpPath}?error=permission`);
  await withActor(ctx.user.id, (tx) =>
    createHonorarium(
      {
        entityId,
        recipientName: String(formData.get("recipient_name") || "").trim(),
        recipientType: "resident_intercessor",
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
  revalidatePath(nlpPath);
  revalidatePath("/payroll/honorariums");
  redirect(`${nlpPath}?intercessor=honorarium`);
}
