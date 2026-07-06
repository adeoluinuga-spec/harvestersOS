import "server-only";
import crypto from "node:crypto";
import { sql, type Exec } from "./db";

type Scope = "all" | string[];
const scoped = (col: string, scope: Scope) =>
  scope === "all" ? sql`true` : scope.length === 0 ? sql`false` : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export type OnlinePaymentRow = {
  id: string;
  provider: string;
  event_type: string;
  reference: string | null;
  amount: string | null;
  currency: string | null;
  paid_at: string | null;
  payer_email: string | null;
  payer_phone: string | null;
  payer_name: string | null;
  entity_id: string | null;
  entity_name: string | null;
  giving_type_code: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

export function verifyPaystackSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !signature) return false;
  const digest = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

/** Store a webhook event (idempotent on provider+event id). Returns the row id. */
export async function ingestPaystackEvent(payload: {
  event: string;
  data: Record<string, unknown>;
}): Promise<string | null> {
  const d = payload.data ?? {};
  const customer = (d.customer ?? {}) as Record<string, unknown>;
  const metadata = (d.metadata ?? {}) as Record<string, unknown>;
  const eventId = String(d.id ?? d.reference ?? "");
  if (!eventId) return null;

  // Paystack amounts are in kobo/subunits.
  const amount = d.amount != null ? Number(d.amount) / 100 : null;

  const [row] = await sql<{ id: string }[]>`
    insert into public.online_payment_events
      (provider, event_id, event_type, reference, amount, currency, paid_at,
       payer_email, payer_phone, payer_name, entity_id, giving_type_code, raw)
    values
      ('paystack', ${eventId}, ${payload.event}, ${String(d.reference ?? "") || null},
       ${amount}, ${String(d.currency ?? "NGN").toUpperCase()},
       ${d.paid_at ? String(d.paid_at) : null},
       ${String(customer.email ?? "") || null},
       ${String(customer.phone ?? "") || null},
       ${[customer.first_name, customer.last_name].filter(Boolean).join(" ") || null},
       ${String(metadata.entity_id ?? "") || null},
       ${String(metadata.giving_type ?? "") || null},
       ${sql.json(payload as never)})
    on conflict (provider, event_id) do nothing
    returning id`;
  return row?.id ?? null;
}

/** Run the processor for one event (auto giver match -> posted gift). */
export async function processOnlinePayment(
  eventId: string,
  giverId: string | null = null,
  actorId: string | null = null,
  exec: Exec = sql
): Promise<string> {
  const [row] = await exec<{ process_online_payment: string }[]>`
    select public.process_online_payment(${eventId}, ${giverId}, ${actorId})`;
  return row.process_online_payment;
}

export async function getOnlinePayments(scope: Scope, limit = 100): Promise<OnlinePaymentRow[]> {
  return sql<OnlinePaymentRow[]>`
    select ope.id, ope.provider, ope.event_type, ope.reference, ope.amount::text,
           ope.currency, ope.paid_at::text, ope.payer_email, ope.payer_phone,
           ope.payer_name, ope.entity_id, e.name as entity_name,
           ope.giving_type_code, ope.status, ope.error, ope.created_at::text
    from public.online_payment_events ope
    left join public.entities e on e.id = ope.entity_id
    where ${scope === "all" ? sql`true` : scope.length === 0 ? sql`false` : sql`(ope.entity_id is null or ope.entity_id in ${sql(scope)})`}
    order by case ope.status when 'needs_review' then 0 when 'failed' then 1 else 2 end,
             ope.created_at desc
    limit ${limit}`;
}

export async function getOnlinePaymentSummary(scope: Scope) {
  const [row] = await sql<{ recorded: number; review: number; total_recorded: string }[]>`
    select count(*) filter (where status = 'recorded')::int as recorded,
           count(*) filter (where status in ('needs_review','failed'))::int as review,
           coalesce(sum(amount) filter (where status = 'recorded'), 0)::text as total_recorded
    from public.online_payment_events
    where ${scoped("entity_id", scope)} or entity_id is null`;
  return row;
}

/** Human resolution of a needs_review event: assign entity and/or giver. */
export async function resolveOnlinePayment(
  d: { eventId: string; entityId: string | null; giverId: string | null; actorId: string },
  exec: Exec = sql
): Promise<string> {
  if (d.entityId) {
    await exec`
      update public.online_payment_events set entity_id = ${d.entityId}
      where id = ${d.eventId} and status in ('needs_review','failed','received')`;
  }
  return processOnlinePayment(d.eventId, d.giverId, d.actorId, exec);
}
