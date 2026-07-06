import { NextResponse, type NextRequest } from "next/server";
import {
  ingestPaystackEvent,
  processOnlinePayment,
  verifyPaystackSignature,
} from "@/lib/onlineGiving";

export const dynamic = "force-dynamic";

/**
 * Paystack webhook. Configure this URL in the Paystack dashboard
 * (Settings → API Keys & Webhooks): https://<host>/api/webhooks/paystack
 *
 * Every request is HMAC-verified against PAYSTACK_SECRET_KEY. Successful
 * charges become posted, reconciled gifts automatically when the payer's
 * email/phone resolves to exactly one giver; anything ambiguous waits in
 * Givings → Online payments for human review. Idempotent: Paystack retries
 * are absorbed by the (provider, event_id) unique key.
 */
export async function POST(request: NextRequest) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return NextResponse.json({ error: "paystack not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");
  if (!verifyPaystackSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: { event: string; data: Record<string, unknown> };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const eventRowId = await ingestPaystackEvent(payload);
  // Duplicate delivery (already ingested) — acknowledge so Paystack stops retrying.
  if (!eventRowId) return NextResponse.json({ ok: true, duplicate: true });

  const status = await processOnlinePayment(eventRowId);
  return NextResponse.json({ ok: true, status });
}
