"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type AuthContext } from "@/lib/auth";
import { withActor } from "@/lib/db";
import {
  addEventCost,
  addEventRevenue,
  addInventoryMovement,
  createEvent,
  createInventoryItem,
  updateEventAttribution,
} from "@/lib/events";

const EVENT_ROLES = new Set([
  "super_admin",
  "event_finance_lead",
  "finance_processor",
  "campus_finance_officer",
  "sub_group_finance_officer",
  "group_finance_officer",
  "campus_admin",
]);

function canWrite(ctx: AuthContext, entityId?: string) {
  if (ctx.isSuperAdmin) return true;
  return Boolean(entityId && ctx.accessibleEntityIds.includes(entityId)) &&
    ctx.roles.some((r) => EVENT_ROLES.has(r.role));
}

export async function createEventAction(formData: FormData) {
  const ctx = await requireUser();
  const hostingEntityId = String(formData.get("hosting_entity_id") || "");
  if (!canWrite(ctx, hostingEntityId)) redirect("/events?error=permission");
  await withActor(ctx.user.id, (tx) =>
    createEvent(
      {
        eventName: String(formData.get("event_name") || "").trim(),
        eventType: String(formData.get("event_type") || "general").trim() || "general",
        hostingEntityId,
        startDate: String(formData.get("start_date") || ""),
        endDate: String(formData.get("end_date") || ""),
        attendeeCount: String(formData.get("attendee_count") || "0"),
        status: String(formData.get("status") || "planning"),
      },
      tx
    )
  );
  revalidatePath("/events");
  redirect("/events?event=created");
}

export async function updateAttributionAction(formData: FormData) {
  const ctx = await requireUser();
  if (!ctx.roles.some((r) => EVENT_ROLES.has(r.role))) redirect("/events?error=permission");
  await withActor(ctx.user.id, (tx) =>
    updateEventAttribution(
      {
        eventDetailId: String(formData.get("event_detail_id") || ""),
        policy: String(formData.get("policy") || "host_entity"),
        hostPct: String(formData.get("host_entity_percentage") || "") || null,
        giverPct: String(formData.get("giver_home_entity_percentage") || "") || null,
        notes: String(formData.get("notes") || "").trim() || null,
      },
      tx
    )
  );
  revalidatePath("/events");
  redirect("/events?attribution=saved");
}

export async function addRevenueAction(formData: FormData) {
  const ctx = await requireUser();
  await withActor(ctx.user.id, (tx) =>
    addEventRevenue(
      {
        eventDetailId: String(formData.get("event_detail_id") || ""),
        revenueType: String(formData.get("revenue_type") || "ticket_sales"),
        amount: String(formData.get("amount") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        sourceEntityId: String(formData.get("source_entity_id") || "") || null,
        description: String(formData.get("description") || "").trim() || null,
        receivedAt: String(formData.get("received_at") || new Date().toISOString().slice(0, 10)),
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath("/events/entry");
  revalidatePath("/events/report");
  redirect("/events/entry?revenue=added");
}

export async function addCostAction(formData: FormData) {
  const ctx = await requireUser();
  const costType = String(formData.get("cost_type") || "venue");
  const description = String(formData.get("description") || "").trim();
  if (costType === "hospitality_accommodation" && description.length < 8) {
    redirect("/events/entry?error=hospitality_description");
  }
  await withActor(ctx.user.id, (tx) =>
    addEventCost(
      {
        eventDetailId: String(formData.get("event_detail_id") || ""),
        costType,
        amount: String(formData.get("amount") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
        honorariumId: String(formData.get("honorarium_payment_id") || "") || null,
        description,
        incurredAt: String(formData.get("incurred_at") || new Date().toISOString().slice(0, 10)),
        actor: ctx.user.id,
        splitEntityId: String(formData.get("split_entity_id") || "") || null,
        splitType: String(formData.get("split_type") || "") || null,
        splitValue: String(formData.get("split_value") || "") || null,
      },
      tx
    )
  );
  revalidatePath("/events/entry");
  revalidatePath("/events/report");
  redirect("/events/entry?cost=added");
}

export async function createInventoryItemAction(formData: FormData) {
  const ctx = await requireUser();
  await withActor(ctx.user.id, (tx) =>
    createInventoryItem(
      {
        eventDetailId: String(formData.get("event_detail_id") || ""),
        sku: String(formData.get("sku") || "").trim() || null,
        itemName: String(formData.get("item_name") || "").trim(),
        unitCost: String(formData.get("unit_cost") || "0"),
        unitPrice: String(formData.get("unit_price") || "0"),
        currency: String(formData.get("currency") || "NGN").toUpperCase(),
      },
      tx
    )
  );
  revalidatePath("/events/entry");
  redirect("/events/entry?inventory=item");
}

export async function addInventoryMovementAction(formData: FormData) {
  const ctx = await requireUser();
  await withActor(ctx.user.id, (tx) =>
    addInventoryMovement(
      {
        itemId: String(formData.get("inventory_item_id") || ""),
        movementType: String(formData.get("movement_type") || "stocked"),
        quantity: String(formData.get("quantity") || "0"),
        unitAmount: String(formData.get("unit_amount") || "") || null,
        occurredAt: String(formData.get("occurred_at") || new Date().toISOString().slice(0, 10)),
        notes: String(formData.get("notes") || "").trim() || null,
        actor: ctx.user.id,
      },
      tx
    )
  );
  revalidatePath("/events/entry");
  redirect("/events/entry?inventory=movement");
}
