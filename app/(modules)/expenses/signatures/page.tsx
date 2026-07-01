import Link from "next/link";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { money } from "@/lib/format";
import { getSignatoryQueue } from "@/lib/requisitions";
import { signDisbursementAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SignaturesPage() {
  const ctx = await requireUser();
  const rows = await getSignatoryQueue(ctx.user.id);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <Link href="/expenses" className="font-sans text-xs text-muted-foreground hover:text-ink">Back to requisitions</Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Signatory confirmations</h2>
      </div>
      <Card>
        <CardHeader><CardTitle>Your signature slots</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Disbursement</TableHeaderCell>
                <TableHeaderCell>Slot</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Confirm</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">No signature confirmations are waiting for you.</TableCell></TableRow>}
              {rows.map((r: Record<string, string | number | boolean>) => (
                <TableRow key={`${r.id}-${r.slot_id}`}>
                  <TableCell>
                    <div className="font-medium">{r.entity_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {r.bank_name} · {r.account_number_last4 ?? "----"} · {money(String(r.net_payable_amount))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">Slot {String(r.slot_label)}</div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {r.requires_all_members ? "All members must confirm" : "Any one member completes this slot"} · {String(r.member_count)} eligible
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{humanize(String(r.disbursement_status))}</Badge>
                    {r.already_signed && <div className="mt-1 font-sans text-xs text-status-success">You have confirmed</div>}
                  </TableCell>
                  <TableCell>
                    <form action={signDisbursementAction} className="flex items-end gap-2">
                      <input type="hidden" name="disbursement_id" value={String(r.id)} />
                      <input type="hidden" name="slot_id" value={String(r.slot_id)} />
                      <input type="hidden" name="action" value="approved" />
                      <Field>
                        <Select name="method" defaultValue="bank_platform_approval">
                          <option value="bank_platform_approval">Bank platform</option>
                          <option value="physical_signature_logged">Physical signature</option>
                          <option value="in_app_confirmation">In-app confirmation</option>
                        </Select>
                      </Field>
                      <Button type="submit" size="sm" disabled={Boolean(r.already_signed)}>Confirm</Button>
                    </form>
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
