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
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";
import { getFundEntities, getInvestmentAlerts, getInvestments } from "@/lib/funds";
import {
  createInvestmentAction,
  refreshInvestmentAlertsAction,
  updateInvestmentStatusAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function InvestmentsPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const [entities, investments, alerts] = await Promise.all([
    getFundEntities(scope),
    getInvestments(scope),
    getInvestmentAlerts(scope),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <Link href="/funds" className="font-sans text-xs text-muted-foreground hover:text-ink">Back to funds</Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Investments</h2>
        <p className="font-sans text-sm text-muted-foreground">
          Fixed deposits, treasury bills, maturity alerts, and yield tracking by entity.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Record investment</CardTitle>
          <form action={refreshInvestmentAlertsAction}>
            <Button type="submit" variant="secondary" size="sm">Refresh alerts</Button>
          </form>
        </CardHeader>
        <CardContent>
          <form action={createInvestmentAction} className="grid gap-4 lg:grid-cols-4">
            <Field label="Entity" required className="lg:col-span-2">
              <Select name="entity_id" required>
                <option value="">Select entity</option>
                {entities.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
            <Field label="Type">
              <Select name="investment_type" defaultValue="fixed_deposit">
                <option value="fixed_deposit">Fixed deposit</option>
                <option value="treasury_bill">Treasury bill</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Institution" required><Input name="institution" required /></Field>
            <Field label="Principal" required><Input name="principal_amount" type="number" min="0.01" step="0.01" required /></Field>
            <Field label="Currency"><Input name="currency" defaultValue="NGN" maxLength={3} /></Field>
            <Field label="Interest rate %"><Input name="interest_rate" type="number" min="0" step="0.0001" defaultValue="0" /></Field>
            <Field label="Start date" required><Input name="start_date" type="date" defaultValue={today} required /></Field>
            <Field label="Maturity date" required><Input name="maturity_date" type="date" required /></Field>
            <Button type="submit">Save investment</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Maturity alerts</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {alerts.map((a: Record<string, string>) => (
            <div key={a.id} className="border-b border-paper-200 pb-3 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <div className="font-sans text-sm font-medium">{a.entity_name} · {a.institution}</div>
                <Badge className="border-status-warning/30 bg-status-warning-bg text-status-warning">{a.days_to_maturity} days</Badge>
              </div>
              <div className="mt-1 font-sans text-xs text-muted-foreground">
                Matures {shortDate(a.maturity_date)} · {money(a.principal_amount, a.currency)}
              </div>
            </div>
          ))}
          {alerts.length === 0 && <p className="font-sans text-sm text-muted-foreground">No active maturity alerts.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Yield tracking</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Investment</TableHeaderCell>
                <TableHeaderCell>Dates</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Expected</TableHeaderCell>
                <TableHeaderCell className="text-right">Actual</TableHeaderCell>
                <TableHeaderCell>Update</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {investments.map((i: Record<string, string>) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <div className="font-medium">{i.institution}</div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {i.entity_name} · {humanize(i.investment_type)} · {money(i.principal_amount, i.currency)} @ {i.interest_rate}%
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {shortDate(i.start_date)} → {shortDate(i.maturity_date)}
                  </TableCell>
                  <TableCell><Badge variant="outline">{humanize(i.status)}</Badge></TableCell>
                  <TableCell className="text-right">{money(i.expected_return_amount, i.currency)}</TableCell>
                  <TableCell className="text-right">{money(i.actual_return_amount, i.currency)}</TableCell>
                  <TableCell className="min-w-[260px]">
                    <form action={updateInvestmentStatusAction} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <input type="hidden" name="investment_id" value={i.id} />
                      <Select name="status" defaultValue={i.status}>
                        <option value="active">Active</option>
                        <option value="matured">Matured</option>
                        <option value="liquidated">Liquidated</option>
                      </Select>
                      <Input name="actual_return_amount" type="number" min="0" step="0.01" defaultValue={i.actual_return_amount} />
                      <Button type="submit" size="sm">Save</Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
              {investments.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No investments recorded yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
