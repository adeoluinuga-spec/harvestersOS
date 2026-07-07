import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
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
import { getDocuments } from "@/lib/documents";
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";
import {
  getAdjustments,
  getBatchPayments,
  getPayrollRunLines,
  getRun,
  getRunBatches,
} from "@/lib/payroll";
import {
  addAdjustmentAction,
  approvePayrollRunAction,
  deleteAdjustmentAction,
  markPaymentAction,
  reissuePaymentAction,
  rejectPayrollRunAction,
  submitPayrollRunAction,
} from "../../actions";

export const dynamic = "force-dynamic";

const APPROVER_ROLES = new Set([
  "campus_pastor", "sub_group_pastor", "group_pastor", "global_lead_pastor",
  "ministry_lead", "head_of_expression", "cfo_coo",
]);
const PREPARER_ROLES = new Set([
  "hr_officer", "finance_processor", "group_finance_officer",
  "sub_group_finance_officer", "campus_finance_officer", "cfo_coo",
]);

export default async function PayrollRunPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireUser();
  const run = (await getRun(params.id)) as Record<string, string> | null;
  if (!run) {
    return <div className="mx-auto max-w-3xl font-sans text-sm text-muted-foreground">Run not found.</div>;
  }
  const inScope = ctx.isSuperAdmin || ctx.isAuditor || ctx.accessibleEntityIds.includes(run.entity_id);
  if (!inScope) {
    return <div className="mx-auto max-w-3xl font-sans text-sm text-muted-foreground">Outside your scope.</div>;
  }

  const month = Number(run.period_month);
  const year = Number(run.period_year);
  const [lines, adjustments, batches, documents] = await Promise.all([
    getPayrollRunLines(params.id),
    getAdjustments(run.entity_id, month, year),
    getRunBatches(params.id),
    getDocuments("payroll_run", params.id),
  ]);
  const batchPayments = await Promise.all(
    batches.map(async (b: Record<string, string>) => ({
      batch: b,
      payments: await getBatchPayments(b.id),
    }))
  );

  const totals = lines.reduce(
    (a: { gross: number; ded: number; net: number }, l: Record<string, string>) => ({
      gross: a.gross + Number(l.gross_amount),
      ded: a.ded + Number(l.paye_deducted) + Number(l.pension_deducted) + Number(l.nhf_deducted) + Number(l.other_deductions),
      net: a.net + Number(l.net_amount),
    }),
    { gross: 0, ded: 0, net: 0 }
  );

  const canPrepare = ctx.isSuperAdmin || ctx.roles.some((r) => PREPARER_ROLES.has(r.role));
  const canApprove = ctx.isSuperAdmin || ctx.roles.some((r) => APPROVER_ROLES.has(r.role));
  const back = `/payroll/runs/${params.id}`;
  const error = typeof searchParams?.error === "string" ? decodeURIComponent(searchParams.error) : null;
  const editable = run.status === "draft" || run.status === "rejected";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Link href="/payroll" className="font-sans text-xs text-muted-foreground hover:text-ink">← Payroll</Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-3xl tracking-display text-ink">
              {run.entity_name} — {String(month).padStart(2, "0")}/{year}
            </h2>
            <Badge variant={run.status === "pending_approval" ? "solid" : "outline"}>{humanize(run.status)}</Badge>
          </div>
          <p className="font-sans text-sm text-muted-foreground">
            {lines.length} staff · gross {money(String(totals.gross))} · net {money(String(totals.net))}
            {run.submitted_by_email ? ` · prepared by ${run.submitted_by_email}` : ""}
            {run.approved_by_email ? ` · approved by ${run.approved_by_email}` : ""}
          </p>
          {run.rejection_reason && (
            <p className="font-sans text-xs text-status-danger">Rejected: {run.rejection_reason}</p>
          )}
        </div>

        {/* Lifecycle actions */}
        <div className="flex flex-wrap items-center gap-2">
          {editable && canPrepare && (
            <form action={submitPayrollRunAction} className="flex items-center gap-2">
              <input type="hidden" name="payroll_run_id" value={params.id} />
              <input type="hidden" name="entity_id" value={run.entity_id} />
              <input type="hidden" name="back" value={back} />
              <input
                name="document_file" type="file"
                accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.doc,.docx"
                className="w-52 rounded-md border border-paper-300 bg-surface px-2 py-1.5 font-sans text-xs file:mr-2 file:rounded file:border-0 file:bg-paper-100 file:px-2 file:py-1 file:font-sans file:text-xs"
              />
              <Button type="submit">Submit for approval</Button>
            </form>
          )}
          {run.status === "pending_approval" && canApprove && (
            <>
              <form action={approvePayrollRunAction}>
                <input type="hidden" name="payroll_run_id" value={params.id} />
                <input type="hidden" name="entity_id" value={run.entity_id} />
                <input type="hidden" name="back" value={back} />
                <Button type="submit">Approve payroll</Button>
              </form>
              <form action={rejectPayrollRunAction} className="flex items-center gap-2">
                <input type="hidden" name="payroll_run_id" value={params.id} />
                <input type="hidden" name="entity_id" value={run.entity_id} />
                <input type="hidden" name="back" value={back} />
                <Input name="reason" placeholder="Rejection reason" className="h-9 w-44 text-xs" />
                <Button type="submit" variant="danger">Reject</Button>
              </form>
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded border border-status-danger/30 bg-status-danger-bg px-3 py-2 font-sans text-sm text-status-danger">
          {error === "permission" ? "You do not have permission for that action." : error}
        </p>
      )}

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle>Staff lines</CardTitle>
          <CardDescription>Computed from compensation, tax rules and this period&apos;s adjustments</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Staff</TableHeaderCell>
                <TableHeaderCell className="text-right">Gross</TableHeaderCell>
                <TableHeaderCell className="text-right">PAYE</TableHeaderCell>
                <TableHeaderCell className="text-right">Pension</TableHeaderCell>
                <TableHeaderCell className="text-right">NHF</TableHeaderCell>
                <TableHeaderCell className="text-right">Other ded.</TableHeaderCell>
                <TableHeaderCell className="text-right">Net</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((l: Record<string, string>) => (
                <TableRow key={l.staff_id}>
                  <TableCell>
                    <span className="font-medium">{l.full_name}</span>
                    <span className="ml-2 font-sans text-xs text-muted-foreground">{humanize(l.staff_type)}</span>
                  </TableCell>
                  <TableCell className="text-right">{money(l.gross_amount)}</TableCell>
                  <TableCell className="text-right">{money(l.paye_deducted)}</TableCell>
                  <TableCell className="text-right">{money(l.pension_deducted)}</TableCell>
                  <TableCell className="text-right">{money(l.nhf_deducted)}</TableCell>
                  <TableCell className="text-right">{money(l.other_deductions)}</TableCell>
                  <TableCell className="text-right font-medium">{money(l.net_amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-bold">Totals</TableCell>
                <TableCell className="text-right font-bold">{money(String(totals.gross))}</TableCell>
                <TableCell className="text-right font-bold" colSpan={4}>{money(String(totals.ded))}</TableCell>
                <TableCell className="text-right font-bold">{money(String(totals.net))}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Adjustments */}
      <Card>
        <CardHeader>
          <CardTitle>One-off adjustments — {String(month).padStart(2, "0")}/{year}</CardTitle>
          <CardDescription>
            Bonuses, overtime, loan/co-op deductions, absence. Re-generate the draft after
            changing these; a submitted run must be rejected back to draft first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {adjustments.length > 0 && (
            <ul className="divide-y divide-paper-100">
              {adjustments.map((a: Record<string, string | boolean>) => (
                <li key={String(a.id)} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <span className="font-sans text-sm font-medium text-ink">{String(a.full_name)}</span>
                    <span className="ml-2 font-sans text-xs text-muted-foreground">
                      {String(a.kind)} · {String(a.label)}{a.is_taxable ? " · taxable" : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-sans text-sm font-semibold ${a.kind === "deduction" ? "text-status-danger" : "text-status-success"}`}>
                      {a.kind === "deduction" ? "−" : "+"}{money(String(a.amount))}
                    </span>
                    {editable && canPrepare && (
                      <form action={deleteAdjustmentAction}>
                        <input type="hidden" name="id" value={String(a.id)} />
                        <input type="hidden" name="entity_id" value={run.entity_id} />
                        <input type="hidden" name="back" value={back} />
                        <button className="font-sans text-xs text-muted-foreground hover:text-status-danger">Remove</button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {editable && canPrepare && (
            <form action={addAdjustmentAction} className="grid gap-3 sm:grid-cols-6">
              <input type="hidden" name="entity_id" value={run.entity_id} />
              <input type="hidden" name="period_month" value={month} />
              <input type="hidden" name="period_year" value={year} />
              <input type="hidden" name="back" value={back} />
              <Field label="Staff" required className="sm:col-span-2">
                <Select name="staff_id" required>
                  <option value="">Select staff</option>
                  {lines.map((l: Record<string, string>) => (
                    <option key={l.staff_id} value={l.staff_id}>{l.full_name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Type" required>
                <Select name="kind" defaultValue="deduction">
                  <option value="earning">Earning</option>
                  <option value="deduction">Deduction</option>
                </Select>
              </Field>
              <Field label="Label" required><Input name="label" placeholder="Loan repayment…" required /></Field>
              <Field label="Amount" required><Input name="amount" type="number" min="0.01" step="0.01" required /></Field>
              <div className="flex items-end gap-2">
                <label className="flex h-10 items-center gap-1.5 rounded border border-paper-300 px-2 font-sans text-xs">
                  <input name="is_taxable" type="checkbox" className="h-3.5 w-3.5" /> Taxable
                </label>
                <Button type="submit" size="sm">Add</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Payment batches */}
      {batchPayments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Payment cycles</CardTitle>
            <CardDescription>Half-salary batches — processed on the payments board</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {batchPayments.map(({ batch, payments }) => (
              <div key={batch.id}>
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <span className="font-sans text-sm font-semibold text-ink">
                    Cycle {batch.cycle_no} · {shortDate(batch.planned_date)}
                  </span>
                  <Badge variant={batch.status === "disbursed" ? "solid" : "outline"}>{humanize(batch.status)}</Badge>
                  <span className="font-sans text-sm text-muted-foreground">{money(batch.total_amount)}</span>
                  {batch.bank_name && (
                    <span className="font-sans text-xs text-muted-foreground">
                      {batch.bank_name} ····{batch.account_number_last4}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {payments.map((p: Record<string, string>) => {
                    const tone =
                      p.status === "successful" ? "bg-status-success-bg text-status-success"
                      : p.status === "returned" ? "bg-status-danger-bg text-status-danger"
                      : p.status === "contested" ? "bg-status-warning-bg text-status-warning"
                      : "bg-paper-100 text-ink-500";
                    return (
                      <details key={p.id} className="group relative">
                        <summary className={`cursor-pointer list-none rounded px-2 py-1 font-sans text-[11px] font-medium ${tone} [&::-webkit-details-marker]:hidden`}>
                          {p.full_name} · {money(p.amount)} · {p.status}
                        </summary>
                        {["successful", "returned", "contested"].includes(p.status) && canPrepare && (
                          <div className="absolute z-10 mt-1 flex gap-1 rounded-md border border-paper-200 bg-surface p-2 shadow-lift">
                            {p.status !== "returned" && (
                              <>
                                {p.status !== "successful" && (
                                  <form action={markPaymentAction}>
                                    <input type="hidden" name="payment_id" value={p.id} />
                                    <input type="hidden" name="entity_id" value={run.entity_id} />
                                    <input type="hidden" name="status" value="successful" />
                                    <input type="hidden" name="back" value={back} />
                                    <button className="rounded bg-status-success-bg px-2 py-1 font-sans text-[11px] font-semibold text-status-success">Successful</button>
                                  </form>
                                )}
                                <form action={markPaymentAction}>
                                  <input type="hidden" name="payment_id" value={p.id} />
                                  <input type="hidden" name="entity_id" value={run.entity_id} />
                                  <input type="hidden" name="status" value="returned" />
                                  <input type="hidden" name="back" value={back} />
                                  <button className="rounded bg-status-danger-bg px-2 py-1 font-sans text-[11px] font-semibold text-status-danger">Returned</button>
                                </form>
                                {p.status !== "contested" && (
                                  <form action={markPaymentAction}>
                                    <input type="hidden" name="payment_id" value={p.id} />
                                    <input type="hidden" name="entity_id" value={run.entity_id} />
                                    <input type="hidden" name="status" value="contested" />
                                    <input type="hidden" name="back" value={back} />
                                    <button className="rounded bg-status-warning-bg px-2 py-1 font-sans text-[11px] font-semibold text-status-warning">Contested</button>
                                  </form>
                                )}
                              </>
                            )}
                            {p.status === "returned" && (
                              <form action={reissuePaymentAction}>
                                <input type="hidden" name="payment_id" value={p.id} />
                                <input type="hidden" name="entity_id" value={run.entity_id} />
                                <input type="hidden" name="back" value={back} />
                                <button className="rounded bg-cobalt-light px-2 py-1 font-sans text-[11px] font-semibold text-cobalt">Reissue</button>
                              </form>
                            )}
                          </div>
                        )}
                      </details>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Documents */}
      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>Schedules, approval memos, bank confirmations</CardDescription>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="font-sans text-sm text-muted-foreground">
              None attached yet — add one when submitting for approval.
            </p>
          ) : (
            <ul className="space-y-1">
              {documents.map((d) => (
                <li key={d.id}>
                  <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer"
                     className="font-sans text-sm text-cobalt underline underline-offset-2">
                    📎 {d.file_name}
                  </a>
                  <span className="ml-2 font-sans text-xs text-muted-foreground">
                    {d.uploaded_by_email ?? ""} · {shortDate(d.uploaded_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
