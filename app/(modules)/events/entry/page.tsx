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
  Textarea,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";
import {
  getEventCostLines,
  getEventDetails,
  getEventHostEntities,
  getEventRevenueLines,
  getHonorariumsForEventCost,
  getInventoryBalances,
} from "@/lib/events";
import {
  addCostAction,
  addInventoryMovementAction,
  addRevenueAction,
  createInventoryItemAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function EventEntryPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const [events, entities, revenue, costs, honorariums, inventory] = await Promise.all([
    getEventDetails(scope),
    getEventHostEntities(scope),
    getEventRevenueLines(),
    getEventCostLines(),
    getHonorariumsForEventCost(),
    getInventoryBalances(),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <Link href="/events" className="font-sans text-xs text-muted-foreground hover:text-ink">Back to events</Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Event entry</h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Revenue line</CardTitle></CardHeader>
          <CardContent>
            <form action={addRevenueAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Event" required className="sm:col-span-2">
                <Select name="event_detail_id" required>
                  <option value="">Select event</option>
                  {events.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.event_name}</option>)}
                </Select>
              </Field>
              <Field label="Type">
                <Select name="revenue_type" defaultValue="ticket_sales">
                  <option value="ticket_sales">Ticket sales</option>
                  <option value="sponsorships">Sponsorships</option>
                  <option value="exhibitor_fees">Exhibitor fees</option>
                  <option value="on_site_giving">On-site giving</option>
                  <option value="offerings">Offerings</option>
                  <option value="merchandise">Merchandise</option>
                </Select>
              </Field>
              <Field label="Source entity">
                <Select name="source_entity_id">
                  <option value="">External / unknown</option>
                  {entities.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </Select>
              </Field>
              <Field label="Amount" required><Input name="amount" type="number" min="0.01" step="0.01" required /></Field>
              <Field label="Currency"><Input name="currency" defaultValue="NGN" maxLength={3} /></Field>
              <Field label="Received"><Input name="received_at" type="date" defaultValue={today} /></Field>
              <Field label="Description" className="sm:col-span-2"><Textarea name="description" /></Field>
              <Button type="submit">Add revenue</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cost line</CardTitle></CardHeader>
          <CardContent>
            <form action={addCostAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Event" required className="sm:col-span-2">
                <Select name="event_detail_id" required>
                  <option value="">Select event</option>
                  {events.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.event_name}</option>)}
                </Select>
              </Field>
              <Field label="Cost type">
                <Select name="cost_type" defaultValue="venue">
                  <option value="venue">Venue</option>
                  <option value="logistics">Logistics</option>
                  <option value="speaker_honorarium">Speaker honorarium</option>
                  <option value="hospitality_accommodation">Hospitality/accommodation</option>
                  <option value="staffing">Staffing</option>
                  <option value="production_simulcast">Production/simulcast</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field label="Honorarium link">
                <Select name="honorarium_payment_id">
                  <option value="">No link</option>
                  {honorariums.map((h: Record<string, string>) => <option key={h.id} value={h.id}>{h.recipient_name} · {money(h.amount, h.currency)}</option>)}
                </Select>
              </Field>
              <Field label="Amount" required><Input name="amount" type="number" min="0.01" step="0.01" required /></Field>
              <Field label="Currency"><Input name="currency" defaultValue="NGN" maxLength={3} /></Field>
              <Field label="Incurred"><Input name="incurred_at" type="date" defaultValue={today} /></Field>
              <Field label="Split entity">
                <Select name="split_entity_id">
                  <option value="">No split</option>
                  {entities.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </Select>
              </Field>
              <Field label="Split type">
                <Select name="split_type">
                  <option value="">None</option>
                  <option value="percentage">Percentage</option>
                  <option value="fixed_amount">Fixed amount</option>
                </Select>
              </Field>
              <Field label="Split value"><Input name="split_value" type="number" min="0" step="0.01" /></Field>
              <Field label="Description" required className="sm:col-span-2" hint="Hospitality/accommodation must include a specific description.">
                <Textarea name="description" required />
              </Field>
              <Button type="submit">Add cost</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Event merchandise inventory</CardTitle></CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          <form action={createInventoryItemAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Event" required className="sm:col-span-2">
              <Select name="event_detail_id" required>
                <option value="">Select event</option>
                {events.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.event_name}</option>)}
              </Select>
            </Field>
            <Field label="Item" required><Input name="item_name" required /></Field>
            <Field label="SKU"><Input name="sku" /></Field>
            <Field label="Unit cost"><Input name="unit_cost" type="number" min="0" step="0.01" defaultValue="0" /></Field>
            <Field label="Unit price"><Input name="unit_price" type="number" min="0" step="0.01" defaultValue="0" /></Field>
            <Field label="Currency"><Input name="currency" defaultValue="NGN" maxLength={3} /></Field>
            <Button type="submit">Save item</Button>
          </form>
          <form action={addInventoryMovementAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Item" required className="sm:col-span-2">
              <Select name="inventory_item_id" required>
                <option value="">Select item</option>
                {inventory.map((i: Record<string, string>) => <option key={i.inventory_item_id} value={i.inventory_item_id}>{i.event_name} · {i.item_name}</option>)}
              </Select>
            </Field>
            <Field label="Movement">
              <Select name="movement_type" defaultValue="stocked">
                <option value="stocked">Stocked</option>
                <option value="sold">Sold</option>
                <option value="returned">Returned</option>
                <option value="adjusted">Adjusted</option>
                <option value="unsold">Unsold</option>
              </Select>
            </Field>
            <Field label="Quantity"><Input name="quantity" type="number" step="1" required /></Field>
            <Field label="Unit amount"><Input name="unit_amount" type="number" min="0" step="0.01" /></Field>
            <Field label="Date"><Input name="occurred_at" type="date" defaultValue={today} /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" /></Field>
            <Button type="submit">Add movement</Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recent revenue</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {revenue.slice(0, 8).map((r: Record<string, string>) => (
              <div key={r.id} className="border-b border-paper-200 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-sans text-sm font-medium">{r.event_name}</div>
                  <Badge variant="outline">{humanize(r.revenue_type)}</Badge>
                </div>
                <div className="font-sans text-xs text-muted-foreground">{shortDate(r.received_at)} · {money(r.amount, r.currency)}</div>
              </div>
            ))}
            {revenue.length === 0 && <p className="font-sans text-sm text-muted-foreground">No revenue lines yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent costs</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {costs.slice(0, 8).map((c: Record<string, string>) => (
              <div key={c.id} className="border-b border-paper-200 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-sans text-sm font-medium">{c.event_name}</div>
                  <Badge variant="outline">{humanize(c.cost_type)}</Badge>
                </div>
                <div className="font-sans text-xs text-muted-foreground">{shortDate(c.incurred_at)} · {money(c.amount, c.currency)} · {c.description}</div>
              </div>
            ))}
            {costs.length === 0 && <p className="font-sans text-sm text-muted-foreground">No cost lines yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
