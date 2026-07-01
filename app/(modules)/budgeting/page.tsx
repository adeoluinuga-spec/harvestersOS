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
import { FUND_CLASSIFICATIONS, humanize } from "@/lib/enums";
import { money } from "@/lib/format";
import {
  getBudgetAccounts,
  getBudgetCycles,
  getBudgetEntities,
  getBudgetLines,
  getBudgetRollup,
} from "@/lib/budgeting";
import {
  createBudgetCycleAction,
  reviewBudgetLineAction,
  setBudgetModeAction,
  submitBudgetLineAction,
  updateBudgetCycleStatusAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function BudgetingPage({
  searchParams,
}: {
  searchParams?: { cycle?: string; fund?: string };
}) {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const [entities, accounts, cycles] = await Promise.all([
    getBudgetEntities(scope),
    getBudgetAccounts(),
    getBudgetCycles(),
  ]);
  const activeCycle = searchParams?.cycle || String(cycles[0]?.id ?? "");
  const fund = searchParams?.fund || "";
  const [lines, rollup] = await Promise.all([
    getBudgetLines(scope, activeCycle),
    getBudgetRollup(scope, activeCycle, fund),
  ]);
  const year = new Date().getFullYear();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <h2 className="font-display text-3xl tracking-display text-ink">Budgeting</h2>
        <p className="font-sans text-sm text-muted-foreground">
          Bottom-up submissions with top-down rollup review and budget-vs-actual visibility.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Budget cycle</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            {ctx.isSuperAdmin && (
              <form action={createBudgetCycleAction} className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Field label="Fiscal year"><Input name="fiscal_year" type="number" defaultValue={year + 1} /></Field>
                <Button type="submit" className="mt-6">Create</Button>
              </form>
            )}
            <form action="/budgeting" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" method="get">
              <Field label="View cycle">
                <Select name="cycle" defaultValue={activeCycle}>
                  {cycles.map((c: Record<string, string>) => (
                    <option key={c.id} value={c.id}>{c.fiscal_year} · {humanize(c.status)}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Fund">
                <Select name="fund" defaultValue={fund}>
                  <option value="">All funds</option>
                  {FUND_CLASSIFICATIONS.map((f) => <option key={f} value={f}>{humanize(f)}</option>)}
                </Select>
              </Field>
              <Button type="submit" variant="secondary" className="mt-6">Filter</Button>
            </form>
            {ctx.isSuperAdmin && activeCycle && (
              <form action={updateBudgetCycleStatusAction} className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <input type="hidden" name="budget_cycle_id" value={activeCycle} />
                <Field label="Cycle status">
                  <Select name="status" defaultValue="under_review">
                    <option value="open_for_submission">Open for submission</option>
                    <option value="under_review">Under review</option>
                    <option value="approved">Approved</option>
                    <option value="closed">Closed</option>
                  </Select>
                </Field>
                <Button type="submit" className="mt-6">Update</Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Entity enforcement</CardTitle></CardHeader>
          <CardContent>
            <form action={setBudgetModeAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="Entity">
                <Select name="entity_id" required>
                  <option value="">Select entity</option>
                  {entities.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </Select>
              </Field>
              <Field label="Mode">
                <Select name="enforcement_mode" defaultValue="warn">
                  <option value="warn">Warn</option>
                  <option value="block">Block</option>
                  <option value="none">None</option>
                </Select>
              </Field>
              <Button type="submit" className="mt-6">Save</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Submit budget line</CardTitle></CardHeader>
        <CardContent>
          <form action={submitBudgetLineAction} className="grid gap-4 lg:grid-cols-4">
            <Field label="Cycle" required>
              <Select name="budget_cycle_id" defaultValue={activeCycle} required>
                {cycles.map((c: Record<string, string>) => (
                  <option key={c.id} value={c.id}>{c.fiscal_year} · {humanize(c.status)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Entity" required>
              <Select name="entity_id" required>
                <option value="">Select entity</option>
                {entities.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
            <Field label="Account" required>
              <Select name="account_id" required>
                <option value="">Select account</option>
                {accounts.map((a: Record<string, string>) => (
                  <option key={a.id} value={a.id}>{a.code} · {a.name} · {humanize(a.fund_classification)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Proposed amount" required>
              <Input name="proposed_amount" type="number" min="0" step="0.01" required />
            </Field>
            <Field label="Prior line" className="lg:col-span-2">
              <Select name="prior_budget_line_id">
                <option value="">No prior linkage</option>
                {lines.map((l: Record<string, string>) => (
                  <option key={l.id} value={l.id}>
                    {l.fiscal_year} · {l.entity_name} · {l.account_code} · {money(l.approved_amount ?? l.proposed_amount)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes" className="lg:col-span-2">
              <Textarea name="notes" placeholder="Assumptions, programme detail, or forecast basis" />
            </Field>
            <Button type="submit">Submit line</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Rollup dashboard</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Fund</TableHeaderCell>
                <TableHeaderCell className="text-right">Proposed</TableHeaderCell>
                <TableHeaderCell className="text-right">Approved</TableHeaderCell>
                <TableHeaderCell className="text-right">Actual</TableHeaderCell>
                <TableHeaderCell className="text-right">Variance</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rollup.map((r: Record<string, string>) => (
                <TableRow key={`${r.entity_id}-${r.fund_classification}`}>
                  <TableCell>
                    <div className="font-medium">{r.entity_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">{humanize(r.entity_type)} · {r.line_count} lines</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{humanize(r.fund_classification)}</Badge></TableCell>
                  <TableCell className="text-right">{money(r.proposed_amount)}</TableCell>
                  <TableCell className="text-right">{money(r.approved_amount)}</TableCell>
                  <TableCell className="text-right">{money(r.actual_amount)}</TableCell>
                  <TableCell className="text-right font-medium">{money(r.variance_amount)}</TableCell>
                </TableRow>
              ))}
              {rollup.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No rollup data for this filter.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Budget line review</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Line</TableHeaderCell>
                <TableHeaderCell>Historical link</TableHeaderCell>
                <TableHeaderCell className="text-right">Proposed</TableHeaderCell>
                <TableHeaderCell className="text-right">Actual</TableHeaderCell>
                <TableHeaderCell>Review</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((l: Record<string, string>) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="font-medium">{l.entity_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {l.account_code} · {l.account_name} · {humanize(l.fund_classification)}
                    </div>
                    {l.notes && <div className="mt-1 font-sans text-xs text-muted-foreground">{l.notes}</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.prior_budget_line_id ? (
                      <span>Prior approved {money(l.prior_approved_amount ?? l.prior_proposed_amount ?? "0")}</span>
                    ) : "No prior link"}
                  </TableCell>
                  <TableCell className="text-right">{money(l.proposed_amount)}</TableCell>
                  <TableCell className="text-right">{money(l.actual_amount)}</TableCell>
                  <TableCell className="min-w-[280px]">
                    <form action={reviewBudgetLineAction} className="space-y-2">
                      <input type="hidden" name="budget_line_id" value={l.id} />
                      <div className="grid grid-cols-[1fr_1.5fr_auto] gap-2">
                        <Input name="approved_amount" type="number" min="0" step="0.01" defaultValue={l.approved_amount ?? l.proposed_amount} />
                        <Input name="review_justification" placeholder="Required justification" defaultValue={l.review_justification ?? ""} />
                        <Button type="submit" size="sm">Save</Button>
                      </div>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
              {lines.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No budget lines for this cycle.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
