import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { money, shortDate } from "@/lib/format";
import {
  getEventCloseout,
  getEventDetails,
  getEventHistoricalComparison,
  getInventoryBalances,
} from "@/lib/events";

export const dynamic = "force-dynamic";

export default async function EventReportPage({
  searchParams,
}: {
  searchParams?: { event?: string; type?: string };
}) {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const events = await getEventDetails(scope);
  const selectedEvent = searchParams?.event || String(events[0]?.id ?? "");
  const selected = events.find((e: Record<string, string>) => e.id === selectedEvent) as Record<string, string> | undefined;
  const eventType = searchParams?.type || selected?.event_type || "";
  const [closeout, inventory, history] = await Promise.all([
    getEventCloseout(selectedEvent),
    getInventoryBalances(selectedEvent),
    getEventHistoricalComparison(eventType),
  ]);
  const summary = (closeout[0] ?? {
    total_revenue: "0",
    total_cost: "0",
    net_position: "0",
    cost_per_attendee: null,
    currency: "NGN",
  }) as Record<string, string | null>;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <Link href="/events" className="font-sans text-xs text-muted-foreground hover:text-ink">Back to events</Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Event close-out</h2>
      </div>

      <Card>
        <CardHeader><CardTitle>Report filter</CardTitle></CardHeader>
        <CardContent>
          <form action="/events/report" method="get" className="grid gap-4 sm:grid-cols-[2fr_1fr_auto]">
            <Field label="Event">
              <Select name="event" defaultValue={selectedEvent}>
                {events.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.event_name}</option>)}
              </Select>
            </Field>
            <Field label="Comparison type">
              <Select name="type" defaultValue={eventType}>
                <option value="">All types</option>
                {Array.from(new Set(events.map((e: Record<string, string>) => e.event_type))).map((t) => (
                  <option key={String(t)} value={String(t)}>{String(t)}</option>
                ))}
              </Select>
            </Field>
            <Button type="submit" className="mt-6" variant="secondary">View</Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <div className="font-sans text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Revenue</div>
            <div className="mt-1 font-display text-xl tracking-display text-ink">{money(String(summary.total_revenue), String(summary.currency ?? "NGN"))}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="font-sans text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Cost</div>
            <div className="mt-1 font-display text-xl tracking-display text-ink">{money(String(summary.total_cost), String(summary.currency ?? "NGN"))}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="font-sans text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Net position</div>
            <div className="mt-1 font-display text-xl tracking-display text-ink">{money(String(summary.net_position), String(summary.currency ?? "NGN"))}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="font-sans text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Cost / attendee</div>
            <div className="mt-1 font-display text-xl tracking-display text-ink">{summary.cost_per_attendee ? money(String(summary.cost_per_attendee), String(summary.currency ?? "NGN")) : "n/a"}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Close-out by currency</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Event</TableHeaderCell>
                <TableHeaderCell>Currency</TableHeaderCell>
                <TableHeaderCell className="text-right">Revenue</TableHeaderCell>
                <TableHeaderCell className="text-right">Cost</TableHeaderCell>
                <TableHeaderCell className="text-right">Net</TableHeaderCell>
                <TableHeaderCell className="text-right">CPA</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {closeout.map((p: Record<string, string>) => (
                <TableRow key={`${p.event_detail_id}-${p.currency}`}>
                  <TableCell>
                    <div className="font-medium">{p.event_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">{p.attendee_count} attendees · {shortDate(p.start_date)}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{p.currency ?? "NGN"}</Badge></TableCell>
                  <TableCell className="text-right">{money(p.total_revenue, p.currency)}</TableCell>
                  <TableCell className="text-right">{money(p.total_cost, p.currency)}</TableCell>
                  <TableCell className="text-right font-medium">{money(p.net_position, p.currency)}</TableCell>
                  <TableCell className="text-right">{p.cost_per_attendee ? money(p.cost_per_attendee, p.currency) : "n/a"}</TableCell>
                </TableRow>
              ))}
              {closeout.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No P&L lines for this event yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Inventory close-out</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {inventory.map((i: Record<string, string>) => (
              <div key={i.inventory_item_id} className="border-b border-paper-200 pb-3 last:border-0 last:pb-0">
                <div className="font-sans text-sm font-medium">{i.item_name}</div>
                <div className="font-sans text-xs text-muted-foreground">
                  Sold {i.quantity_sold} · on hand {i.quantity_on_hand} · price {money(i.unit_price, i.currency)}
                </div>
              </div>
            ))}
            {inventory.length === 0 && <p className="font-sans text-sm text-muted-foreground">No event inventory recorded.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Historical comparison</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {history.map((h: Record<string, string>) => (
              <div key={h.event_detail_id} className="border-b border-paper-200 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-sans text-sm font-medium">{h.event_name}</div>
                  <Badge variant="outline">{h.event_type}</Badge>
                </div>
                <div className="font-sans text-xs text-muted-foreground">
                  {shortDate(h.start_date)} · revenue {money(h.total_revenue)} · cost {money(h.total_cost)} · net {money(h.net_position)}
                </div>
              </div>
            ))}
            {history.length === 0 && <p className="font-sans text-sm text-muted-foreground">No historical comparison yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
