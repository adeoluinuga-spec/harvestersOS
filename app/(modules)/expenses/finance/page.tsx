import Link from "next/link";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { money } from "@/lib/format";
import { getBankAccounts, getDisbursements, getFinanceQueue } from "@/lib/requisitions";
import { ImportButton } from "@/components/ImportButton";
import { createDisbursementAction, markDisbursedAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const [queue, disbursements, banks] = await Promise.all([
    getFinanceQueue(scope),
    getDisbursements(scope),
    getBankAccounts(scope),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <Link href="/expenses" className="font-sans text-xs text-muted-foreground hover:text-ink">Back to requisitions</Link>
          <h2 className="font-display text-3xl tracking-display text-ink">Finance processing</h2>
        </div>
        <ImportButton type="disbursements" label="Upload payment references" />
      </div>

      <Card>
        <CardHeader><CardTitle>Approved and ready for bank upload</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Item</TableHeaderCell>
                <TableHeaderCell>Net payable</TableHeaderCell>
                <TableHeaderCell>Bank</TableHeaderCell>
                <TableHeaderCell>References</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {queue.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No approved items are waiting for finance.</TableCell></TableRow>}
              {queue.map((q: Record<string, string | boolean>) => (
                <TableRow key={`${q.subject_type}-${q.subject_id}`}>
                  <TableCell>
                    <div className="font-medium">{String(q.title)}</div>
                    <div className="mt-1 flex gap-2">
                      <Badge variant="outline">{humanize(String(q.subject_type))}</Badge>
                      {q.is_urgent && <Badge className="border-status-warning/30 bg-status-warning-bg text-status-warning">Urgent</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{money(String(q.net_payable_amount), String(q.currency))}</div>
                    <div className="font-sans text-xs text-muted-foreground">WHT {money(String(q.wht_withheld_amount), String(q.currency))}</div>
                  </TableCell>
                  <TableCell colSpan={3}>
                    <form action={createDisbursementAction} className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
                      <input type="hidden" name="subject_type" value={String(q.subject_type)} />
                      <input type="hidden" name="subject_id" value={String(q.subject_id)} />
                      <Field>
                        <Select name="bank_account_id" required>
                          <option value="">Select bank account</option>
                          {banks.map((b: Record<string, string>) => (
                            <option key={b.id} value={b.id}>
                              {b.entity_name} · {b.bank_name} · {b.account_number_last4 ?? "----"}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Input name="bank_upload_reference" placeholder="Upload ref" />
                      <Input name="transfer_instruction_reference" placeholder="Instruction ref" />
                      <Button type="submit" size="sm">Send</Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Disbursement records</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Record</TableHeaderCell>
                <TableHeaderCell>Entity / bank</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Net</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {disbursements.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="font-mono text-xs">{d.id.slice(0, 8)}</div>
                    <Badge variant="outline">{humanize(d.subject_type)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{d.entity_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">{d.bank_name} · {d.account_number_last4 ?? "----"}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{humanize(d.disbursement_status)}</Badge></TableCell>
                  <TableCell className="text-right font-medium">{money(d.net_payable_amount)}</TableCell>
                  <TableCell className="text-right">
                    {d.disbursement_status === "fully_signed" && (
                      <form action={markDisbursedAction}>
                        <input type="hidden" name="disbursement_id" value={d.id} />
                        <Button type="submit" size="sm">Mark disbursed</Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {disbursements.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No disbursement records yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
