import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Textarea,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";
import { getEventDetails, getEventHostEntities } from "@/lib/events";
import { createEventAction, updateAttributionAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const [hosts, events] = await Promise.all([
    getEventHostEntities(scope),
    getEventDetails(scope),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-3xl tracking-display text-ink">Events</h2>
          <p className="font-sans text-sm text-muted-foreground">
            Temporary event cost centers with mini-P&L, attribution rules, cost sharing, and inventory.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/events/entry" className="font-sans text-xs text-muted-foreground hover:text-ink">Entry</Link>
          <Link href="/events/report" className="font-sans text-xs text-muted-foreground hover:text-ink">Close-out</Link>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Create event</CardTitle></CardHeader>
        <CardContent>
          <form action={createEventAction} className="grid gap-4 lg:grid-cols-4">
            <Field label="Event name" required className="lg:col-span-2"><Input name="event_name" required /></Field>
            <Field label="Event type"><Input name="event_type" defaultValue="conference" /></Field>
            <Field label="Host" required>
              <Select name="hosting_entity_id" required>
                <option value="">Select host</option>
                {hosts.map((h: Record<string, string>) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </Select>
            </Field>
            <Field label="Start" required><Input name="start_date" type="date" defaultValue={today} required /></Field>
            <Field label="End" required><Input name="end_date" type="date" defaultValue={today} required /></Field>
            <Field label="Attendees"><Input name="attendee_count" type="number" min="0" defaultValue="0" /></Field>
            <Field label="Status">
              <Select name="status" defaultValue="planning">
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </Select>
            </Field>
            <Button type="submit">Create event</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Giving attribution rule</CardTitle></CardHeader>
        <CardContent>
          <form action={updateAttributionAction} className="grid gap-4 lg:grid-cols-5">
            <Field label="Event" required className="lg:col-span-2">
              <Select name="event_detail_id" required>
                <option value="">Select event</option>
                {events.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.event_name}</option>)}
              </Select>
            </Field>
            <Field label="Policy">
              <Select name="policy" defaultValue="host_entity">
                <option value="host_entity">Count to host entity</option>
                <option value="giver_home_entity">Count to giver home entity</option>
                <option value="split">Split</option>
              </Select>
            </Field>
            <Field label="Host %"><Input name="host_entity_percentage" type="number" min="0" max="100" step="0.01" /></Field>
            <Field label="Home %"><Input name="giver_home_entity_percentage" type="number" min="0" max="100" step="0.01" /></Field>
            <Field label="Notes" className="lg:col-span-5"><Textarea name="notes" /></Field>
            <Button type="submit">Save rule</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Event dashboard</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Event</TableHeaderCell>
                <TableHeaderCell>Host</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Revenue</TableHeaderCell>
                <TableHeaderCell className="text-right">Cost</TableHeaderCell>
                <TableHeaderCell className="text-right">Net</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {events.map((e: Record<string, string>) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="font-medium">{e.event_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {e.event_type} · {shortDate(e.start_date)} → {shortDate(e.end_date)} · {e.attendee_count} attendees
                    </div>
                  </TableCell>
                  <TableCell>{e.hosting_entity_name}</TableCell>
                  <TableCell><Badge variant="outline">{humanize(e.status)}</Badge></TableCell>
                  <TableCell className="text-right">{money(e.total_revenue, e.currency ?? "NGN")}</TableCell>
                  <TableCell className="text-right">{money(e.total_cost, e.currency ?? "NGN")}</TableCell>
                  <TableCell className="text-right font-medium">{money(e.net_position, e.currency ?? "NGN")}</TableCell>
                </TableRow>
              ))}
              {events.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No events created yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
