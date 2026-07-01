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
import {
  getHonorariumApprovalInbox,
  getHonorariums,
  getPayrollEntities,
} from "@/lib/payroll";
import {
  createHonorariumAction,
  decideHonorariumAction,
  postHonorariumAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function HonorariumsPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const roles = Array.from(new Set(ctx.roles.map((r) => r.role)));
  const [entities, honorariums, inbox] = await Promise.all([
    getPayrollEntities(scope),
    getHonorariums(scope),
    getHonorariumApprovalInbox(roles),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const events = entities.filter((e: Record<string, string>) => e.type === "event");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <Link href="/payroll" className="font-sans text-xs text-muted-foreground hover:text-ink">Back to payroll</Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Honorariums</h2>
        <p className="font-sans text-sm text-muted-foreground">
          Guest minister and visiting speaker payments, separate from payroll and vendor expenses.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Record honorarium</CardTitle></CardHeader>
        <CardContent>
          <form action={createHonorariumAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Entity" required className="lg:col-span-2">
              <Select name="entity_id" required>
                <option value="">Select entity</option>
                {entities.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
            <Field label="Recipient" required className="lg:col-span-2"><Input name="recipient_name" required /></Field>
            <Field label="Type" required>
              <Select name="recipient_type" defaultValue="guest_minister">
                <option value="guest_minister">Guest minister</option>
                <option value="visiting_speaker">Visiting speaker</option>
              </Select>
            </Field>
            <Field label="Event">
              <Select name="event_id">
                <option value="">No event</option>
                {events.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
            <Field label="Currency" required><Input name="currency" defaultValue="NGN" maxLength={3} /></Field>
            <Field label="Payment date" required><Input name="payment_date" type="date" defaultValue={today} /></Field>
            <Field label="Amount" required><Input name="amount" type="number" min="0.01" step="0.01" required /></Field>
            <Field label="WHT amount"><Input name="wht_amount" type="number" min="0" step="0.01" defaultValue="0" /></Field>
            <label className="mt-6 flex h-10 items-center gap-2 rounded border border-paper-300 px-3 font-sans text-sm">
              <input name="wht_applicable" type="checkbox" className="h-4 w-4" />
              WHT applies
            </label>
            <Button type="submit" className="mt-6">Submit for approval</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Approvals waiting on your role</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Recipient</TableHeaderCell>
                <TableHeaderCell>Role step</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                <TableHeaderCell>Decision</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {inbox.map((a: Record<string, string | number>) => (
                <TableRow key={String(a.id)}>
                  <TableCell>
                    <div className="font-medium">{a.recipient_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">{humanize(String(a.recipient_type))}</div>
                  </TableCell>
                  <TableCell>{humanize(String(a.approver_role))}</TableCell>
                  <TableCell>{a.entity_name}</TableCell>
                  <TableCell className="text-right">{money(String(a.amount), String(a.currency))}</TableCell>
                  <TableCell className="min-w-[240px]">
                    <form action={decideHonorariumAction} className="space-y-2">
                      <input type="hidden" name="approval_id" value={String(a.id)} />
                      <Textarea name="comments" placeholder="Comments or rejection reason" className="min-h-[60px]" />
                      <div className="flex gap-2">
                        <Button type="submit" name="decision" value="approved" size="sm">Approve</Button>
                        <Button type="submit" name="decision" value="rejected" variant="danger" size="sm">Reject</Button>
                      </div>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
              {inbox.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No honorarium approvals are waiting on your roles.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Honorarium payments</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Recipient</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell className="text-right">Net</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {honorariums.map((h: Record<string, string>) => (
                <TableRow key={h.id}>
                  <TableCell>
                    <div className="font-medium">{h.recipient_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {humanize(h.recipient_type)}{h.event_name ? ` · ${h.event_name}` : ""}
                    </div>
                  </TableCell>
                  <TableCell>{h.entity_name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{humanize(h.status)}</Badge>
                    {h.status === "pending_approval" && (
                      <div className="mt-1 font-sans text-xs text-muted-foreground">Next: {humanize(h.next_approver_role)}</div>
                    )}
                  </TableCell>
                  <TableCell>{shortDate(h.payment_date)}</TableCell>
                  <TableCell className="text-right">
                    <div className="font-medium">{money(String(Number(h.amount) - Number(h.wht_amount)), h.currency)}</div>
                    {Number(h.wht_amount) > 0 && <div className="font-sans text-xs text-muted-foreground">WHT {money(h.wht_amount, h.currency)}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    {h.status === "approved" && (
                      <form action={postHonorariumAction}>
                        <input type="hidden" name="honorarium_id" value={h.id} />
                        <Button type="submit" size="sm">Post paid</Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {honorariums.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No honorariums recorded yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
