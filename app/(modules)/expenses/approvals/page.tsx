import Link from "next/link";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Textarea } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { money } from "@/lib/format";
import { getApprovalInbox } from "@/lib/requisitions";
import { decideApprovalAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const ctx = await requireUser();
  const roles = Array.from(new Set(ctx.roles.map((r) => r.role)));
  const rows = await getApprovalInbox(roles);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <Link href="/expenses" className="font-sans text-xs text-muted-foreground hover:text-ink">Back to requisitions</Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Approvals inbox</h2>
      </div>
      <Card>
        <CardHeader><CardTitle>Ready for your role</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Item</TableHeaderCell>
                <TableHeaderCell>Role step</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                <TableHeaderCell>Decision</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-muted-foreground">No approvals are currently waiting on your roles.</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.title}</div>
                    <div className="mt-1 flex gap-2">
                      <Badge variant="outline">{humanize(r.subject_type)}</Badge>
                      {r.is_urgent && <Badge className="border-status-warning/30 bg-status-warning-bg text-status-warning">Urgent</Badge>}
                      {r.is_board_step && <Badge className="border-status-danger/30 bg-status-danger-bg text-status-danger">Board gate</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-sans text-sm">{humanize(r.approver_role)}</div>
                    <div className="font-sans text-xs text-muted-foreground">Sequence {r.sequence_order}</div>
                  </TableCell>
                  <TableCell>{r.entity_name}</TableCell>
                  <TableCell className="text-right font-medium">{money(r.amount, r.currency)}</TableCell>
                  <TableCell className="min-w-[260px]">
                    <form action={decideApprovalAction} className="space-y-2">
                      <input type="hidden" name="approval_id" value={r.id} />
                      <Field>
                        <Textarea name="comments" placeholder="Comments or rejection reason" className="min-h-[68px]" />
                      </Field>
                      <div className="flex gap-2">
                        <Button type="submit" name="decision" value="approved" size="sm">Approve</Button>
                        <Button type="submit" name="decision" value="rejected" variant="danger" size="sm">Reject</Button>
                      </div>
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
