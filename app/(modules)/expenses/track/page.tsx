import Link from "next/link";
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";
import { getMyRequests } from "@/lib/requisitions";

export const dynamic = "force-dynamic";

export default async function TrackPage() {
  const ctx = await requireUser();
  const rows = await getMyRequests(ctx.user.id);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <Link href="/expenses" className="font-sans text-xs text-muted-foreground hover:text-ink">Back to requisitions</Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Track my requests</h2>
      </div>
      <Card>
        <CardHeader><CardTitle>My requisitions</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Request</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Needed</TableHeaderCell>
                <TableHeaderCell className="text-right">Net payable</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">You have not submitted any requisitions yet.</TableCell></TableRow>}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.description}</div>
                    <div className="mt-1 flex gap-2">
                      <Badge variant="outline">{humanize(r.category)}</Badge>
                      {r.is_urgent && <Badge className="border-status-warning/30 bg-status-warning-bg text-status-warning">Urgent</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>{r.entity_name}</TableCell>
                  <TableCell><Badge variant="outline">{humanize(r.status)}</Badge></TableCell>
                  <TableCell>{r.needed_by_date ? shortDate(r.needed_by_date) : <span className="text-muted-foreground">Open</span>}</TableCell>
                  <TableCell className="text-right">
                    <div className="font-medium">{money(r.net_payable_amount, r.currency)}</div>
                    {Number(r.wht_withheld_amount) > 0 && (
                      <div className="font-sans text-xs text-muted-foreground">WHT {money(r.wht_withheld_amount, r.currency)}</div>
                    )}
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
