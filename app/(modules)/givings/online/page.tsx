import Link from "next/link";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { compactMoney, money, shortDate } from "@/lib/format";
import { getOnlinePayments, getOnlinePaymentSummary } from "@/lib/onlineGiving";
import { searchGivers } from "@/lib/givings";
import { getEntityOptions } from "@/lib/repo";
import { resolveOnlinePaymentAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "outline" | "solid" | "muted"> = {
  recorded: "outline",
  needs_review: "solid",
  failed: "solid",
  ignored: "muted",
  received: "muted",
};

/**
 * Online payments inbox: Paystack webhook events, auto-recorded where the
 * payer resolved to exactly one giver, waiting here for human resolution
 * otherwise. Configure the webhook at /api/webhooks/paystack.
 */
export default async function OnlineGivingPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? ("all" as const) : ctx.accessibleEntityIds;
  const [events, summary, entities, givers] = await Promise.all([
    getOnlinePayments(scope),
    getOnlinePaymentSummary(scope),
    getEntityOptions(),
    searchGivers(""),
  ]);
  const configured = Boolean(process.env.PAYSTACK_SECRET_KEY);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <Link href="/givings" className="font-sans text-xs text-muted-foreground hover:text-ink">
            ← Givings
          </Link>
          <h2 className="font-display text-3xl tracking-display text-ink">Online payments</h2>
          <p className="max-w-2xl font-sans text-sm leading-relaxed text-muted-foreground">
            Successful charges arrive by webhook, resolve to a giver, post to the ledger and
            reconcile — hands-free. Ambiguous payments wait below for a human decision.
          </p>
        </div>
        <Badge variant={configured ? "outline" : "solid"}>
          {configured ? "Paystack connected" : "Paystack key not set"}
        </Badge>
      </div>

      <section className="grid grid-cols-3 gap-3">
        {[
          { label: "Auto-recorded", value: summary.recorded.toLocaleString() },
          { label: "Needs review", value: summary.review.toLocaleString() },
          { label: "Total recorded", value: compactMoney(Number(summary.total_recorded)) },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="py-4">
              <div className="font-sans text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k.label}</div>
              <div className="mt-1 font-display text-2xl text-ink">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>
            Webhook URL: <code className="rounded bg-paper-100 px-1.5 py-0.5 font-mono text-xs">/api/webhooks/paystack</code>
            {" "}— set it in the Paystack dashboard with PAYSTACK_SECRET_KEY in the environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Payment</TableHeaderCell>
                <TableHeaderCell>Payer</TableHeaderCell>
                <TableHeaderCell>Campus</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Resolve</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No online payment events yet. They appear here the moment Paystack calls the webhook.
                  </TableCell>
                </TableRow>
              )}
              {events.map((ev) => (
                <TableRow key={ev.id}>
                  <TableCell>
                    <div className="font-medium">{money(ev.amount ?? "0", ev.currency ?? "NGN")}</div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {ev.reference ?? ev.event_type} · {shortDate(ev.paid_at ?? ev.created_at)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{ev.payer_name ?? "—"}</div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {ev.payer_email ?? ev.payer_phone ?? "no contact"}
                    </div>
                  </TableCell>
                  <TableCell>{ev.entity_name ?? <span className="text-status-danger">unassigned</span>}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[ev.status] ?? "muted"}>{humanize(ev.status)}</Badge>
                    {ev.error && (
                      <div className="mt-1 max-w-[16rem] font-sans text-xs text-muted-foreground">{ev.error}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {(ev.status === "needs_review" || ev.status === "failed") && (
                      <form action={resolveOnlinePaymentAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="event_id" value={ev.id} />
                        {!ev.entity_id && (
                          <Select name="entity_id" className="h-8 w-40 text-xs" defaultValue="">
                            <option value="" disabled>Campus…</option>
                            {entities.map((e) => (
                              <option key={e.id} value={e.id}>{e.name}</option>
                            ))}
                          </Select>
                        )}
                        <Select name="giver_id" className="h-8 w-44 text-xs" defaultValue="">
                          <option value="">Giver (exact match retry)</option>
                          {givers.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.full_name}{g.phone ? ` · ${g.phone}` : ""}
                            </option>
                          ))}
                        </Select>
                        <button className="rounded border border-ink px-2.5 py-1 font-sans text-xs font-semibold text-ink transition-colors hover:bg-ink hover:text-paper">
                          Record
                        </button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
