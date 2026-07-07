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
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";
import { getBankAccounts } from "@/lib/requisitions";
import { getOpenBatches, getPaymentStatusBoard } from "@/lib/payroll";
import {
  disburseBatchAction,
  markBatchUploadedAction,
  signBatchAction,
} from "../actions";

export const dynamic = "force-dynamic";

/**
 * Payments board: open batches through upload → account-signatory
 * confirmation → disbursement, plus the campus/ministry status rollup
 * (successful / returned / contested / in-flight) per cycle.
 */
export default async function PayrollPaymentsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? ("all" as const) : ctx.accessibleEntityIds;
  const [batches, board, banks] = await Promise.all([
    getOpenBatches(scope),
    getPaymentStatusBoard(scope),
    getBankAccounts(scope),
  ]);
  const error = typeof searchParams?.error === "string" ? decodeURIComponent(searchParams.error) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <Link href="/payroll" className="font-sans text-xs text-muted-foreground hover:text-ink">← Payroll</Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Salary payments</h2>
        <p className="font-sans text-sm text-muted-foreground">
          Upload each approved cycle to the bank, collect the account signatories, disburse —
          then track successes, returns and contests per campus and ministry.
        </p>
      </div>

      {error && (
        <p className="rounded border border-status-danger/30 bg-status-danger-bg px-3 py-2 font-sans text-sm text-status-danger">
          {error === "permission" ? "You do not have permission for that action." : error}
        </p>
      )}

      {/* Open batches */}
      <Card>
        <CardHeader>
          <CardTitle>Batches in flight</CardTitle>
          <CardDescription>Approved payroll cycles that have not yet been disbursed</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Cycle</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Action</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {batches.map((b: Record<string, string | number>) => (
                <TableRow key={String(b.id)}>
                  <TableCell>
                    <div className="font-medium">{shortDate(String(b.planned_date))}</div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {String(b.period_month).padStart(2, "0")}/{b.period_year} ·
                      {b.cycle_no === 3 ? " supplementary" : ` cycle ${b.cycle_no}`}
                    </div>
                  </TableCell>
                  <TableCell>{b.entity_name}</TableCell>
                  <TableCell className="text-right font-medium">{money(String(b.total_amount))}</TableCell>
                  <TableCell>
                    <Badge variant={b.status === "fully_signed" ? "solid" : "outline"}>{humanize(String(b.status))}</Badge>
                    {b.bank_name && (
                      <div className="mt-1 font-sans text-xs text-muted-foreground">
                        {b.bank_name} ····{b.account_number_last4}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="min-w-[320px]">
                    {b.status === "pending_upload" && (
                      <form action={markBatchUploadedAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <input type="hidden" name="batch_id" value={String(b.id)} />
                        <input type="hidden" name="entity_id" value={String(b.entity_id)} />
                        <Field className="sm:col-span-2">
                          <Select name="bank_account_id" required>
                            <option value="">Paying bank account</option>
                            {banks.map((a: Record<string, string>) => (
                                <option key={a.id} value={a.id}>
                                  {a.entity_name} · {a.bank_name} ····{a.account_number_last4 ?? "----"}
                                </option>
                              ))}
                          </Select>
                        </Field>
                        <Button type="submit" size="sm" className="self-start">Uploaded</Button>
                        <Input name="bank_upload_reference" placeholder="Upload ref" className="h-8 text-xs" />
                        <Input name="transfer_instruction_reference" placeholder="Instruction ref" className="h-8 text-xs" />
                      </form>
                    )}
                    {b.status === "pending_signatures" && (
                      <form action={signBatchAction}>
                        <input type="hidden" name="batch_id" value={String(b.id)} />
                        <Button type="submit" size="sm" variant="secondary">Sign (account signatory)</Button>
                      </form>
                    )}
                    {b.status === "fully_signed" && (
                      <form action={disburseBatchAction}>
                        <input type="hidden" name="batch_id" value={String(b.id)} />
                        <input type="hidden" name="entity_id" value={String(b.entity_id)} />
                        <Button type="submit" size="sm">Mark disbursed</Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {batches.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-muted-foreground">No batches awaiting processing.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Status rollup */}
      <Card>
        <CardHeader>
          <CardTitle>Payment status by campus & ministry</CardTitle>
          <CardDescription>
            Per cycle: successful, returned, contested, in flight. Mark individual
            outcomes on the run page.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Cycle</TableHeaderCell>
                <TableHeaderCell className="text-right">Payments</TableHeaderCell>
                <TableHeaderCell className="text-right">Successful</TableHeaderCell>
                <TableHeaderCell className="text-right">Returned</TableHeaderCell>
                <TableHeaderCell className="text-right">Contested</TableHeaderCell>
                <TableHeaderCell className="text-right">Amount</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {board.map((r: Record<string, string | number>, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.entity_name}</TableCell>
                  <TableCell>
                    <span className="font-sans text-sm">{shortDate(String(r.planned_date))}</span>
                    <Badge variant="outline" className="ml-2">{humanize(String(r.batch_status))}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{r.payment_count}</TableCell>
                  <TableCell className="text-right text-status-success">{r.successful_count}</TableCell>
                  <TableCell className={`text-right ${Number(r.returned_count) > 0 ? "font-semibold text-status-danger" : "text-muted-foreground"}`}>
                    {r.returned_count}
                    {Number(r.returned_amount) > 0 && (
                      <span className="ml-1 font-sans text-xs">({money(String(r.returned_amount))})</span>
                    )}
                  </TableCell>
                  <TableCell className={`text-right ${Number(r.contested_count) > 0 ? "font-semibold text-status-warning" : "text-muted-foreground"}`}>
                    {r.contested_count}
                  </TableCell>
                  <TableCell className="text-right font-medium">{money(String(r.total_amount))}</TableCell>
                </TableRow>
              ))}
              {board.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-muted-foreground">No payment cycles yet — approve a payroll run to spawn its batches.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
