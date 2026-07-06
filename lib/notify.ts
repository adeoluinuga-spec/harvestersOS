import "server-only";
import { sql, type Exec } from "./db";

/**
 * Notifications: in-app rows (`notifications` table, shown on dashboards) plus a
 * provider-agnostic `message_outbox` (email / SMS / WhatsApp). Outbox messages
 * queue even without provider keys and deliver once TERMII_API_KEY /
 * RESEND_API_KEY are configured â€” nothing is lost.
 */

export type InAppNotice = {
  userId?: string | null;   // a specific userâ€¦
  role?: string | null;     // â€¦or everyone holding a role
  entityId?: string | null; // â€¦scoped to an entity
  title: string;
  body: string;
  href?: string | null;
};

export async function notifyInApp(n: InAppNotice, exec: Exec = sql): Promise<void> {
  await exec`
    insert into public.notifications (user_id, role, entity_id, title, body, href)
    values (${n.userId ?? null}, ${n.role ? exec`${n.role}::public.app_role` : null},
            ${n.entityId ?? null}, ${n.title}, ${n.body}, ${n.href ?? null})`;
}

export async function queueMessage(
  m: {
    channel: "email" | "sms" | "whatsapp";
    toContact?: string | null;
    toUserId?: string | null;
    subject?: string | null;
    body: string;
    kind: string;
    context?: Record<string, unknown>;
    entityId?: string | null;
  },
  createdBy: string,
  exec: Exec = sql
): Promise<void> {
  await exec`
    insert into public.message_outbox
      (channel, to_contact, to_user_id, subject, body, kind, context, entity_id, created_by)
    values (${m.channel}::public.message_channel, ${m.toContact ?? null}, ${m.toUserId ?? null},
            ${m.subject ?? null}, ${m.body}, ${m.kind},
            ${m.context ? exec.json(m.context as never) : null}, ${m.entityId ?? null}, ${createdBy})`;
}

/** Users holding a role whose grant covers the given entity (via ancestors). */
export async function usersForRoleAtEntity(role: string, entityId: string): Promise<{ id: string; email: string | null }[]> {
  return sql<{ id: string; email: string | null }[]>`
    with recursive up as (
      select id, parent_entity_id from public.entities where id = ${entityId}
      union all
      select e.id, e.parent_entity_id from public.entities e join up on e.id = up.parent_entity_id
    )
    select distinct u.id, u.email
    from public.user_entity_roles uer
    join public.app_users u on u.id = uer.user_id
    where uer.role = ${role}::public.app_role
      and (uer.entity_id is null or uer.entity_id in (select id from up))`;
}

export async function getMyNotifications(userId: string, roles: string[], entityIds: string[], limit = 12) {
  return sql`
    select id, title, body, href, is_read, created_at
    from public.notifications
    where user_id = ${userId}
       or (role is not null and role = any(${roles}::public.app_role[])
           and (entity_id is null or ${entityIds.length ? sql`entity_id in ${sql(entityIds)}` : sql`false`}))
    order by created_at desc limit ${limit}`;
}

// --- Delivery (drain the outbox through providers) --------------------------
async function deliverTermii(channel: "sms" | "whatsapp", to: string, body: string) {
  const key = process.env.TERMII_API_KEY;
  if (!key) return { error: "no_provider" };
  try {
    const res = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        to,
        from: process.env.TERMII_SENDER_ID || "Harvesters",
        sms: body,
        type: "plain",
        channel: channel === "whatsapp" ? "whatsapp" : "generic",
      }),
    });
    if (!res.ok) return { error: `termii ${res.status}` };
    const data = (await res.json()) as { message_id?: string };
    return { id: data.message_id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

async function deliverEmail(to: string, subject: string, body: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { error: "no_provider" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Harvesters Finance OS <noreply@harvestersng.org>",
        to: [to], subject, text: body,
      }),
    });
    if (!res.ok) return { error: `resend ${res.status}` };
    const data = (await res.json()) as { id?: string };
    return { id: data.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Attempt delivery of queued messages. Without keys, everything stays queued. */
export async function processMessageOutbox(limit = 100) {
  const queued = await sql<
    { id: string; channel: string; to_contact: string | null; subject: string | null; body: string }[]
  >`select id, channel, to_contact, subject, body from public.message_outbox
    where status = 'queued' and to_contact is not null order by created_at limit ${limit}`;
  let sent = 0, failed = 0, skipped = 0;
  for (const m of queued) {
    const r =
      m.channel === "email"
        ? await deliverEmail(m.to_contact!, m.subject ?? "Harvesters Finance OS", m.body)
        : await deliverTermii(m.channel as "sms" | "whatsapp", m.to_contact!, m.body);
    if (r.error === "no_provider") { skipped++; continue; }
    if (r.error) {
      failed++;
      await sql`update public.message_outbox set status='failed', attempts=attempts+1, error=${r.error} where id=${m.id}`;
    } else {
      sent++;
      await sql`update public.message_outbox set status='sent', sent_at=now(), provider_message_id=${r.id ?? null} where id=${m.id}`;
    }
  }
  return { sent, failed, skipped, queuedRemaining: queued.length - sent - failed };
}
