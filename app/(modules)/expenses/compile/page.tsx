import Link from "next/link";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { money, shortDate } from "@/lib/format";
import { humanize } from "@/lib/enums";
import { getCompileQueue } from "@/lib/requisitions";
import { compileBatchAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function CompilePage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const rows = await getCompileQueue(scope);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <Link href="/expenses" className="font-sans text-xs text-muted-foreground hover:text-ink">Back to requisitions</Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Compile requests</h2>
      </div>
      <form action={compileBatchAction}>
        <Card>
          <CardHeader>
            <CardTitle>Submitted requests</CardTitle>
            <Button type="submit">Submit batch for approval</Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Select</TableHeaderCell>
                  <TableHeaderCell>Request</TableHeaderCell>
                  <TableHeaderCell>Entity</TableHeaderCell>
                  <TableHeaderCell>Needed</TableHeaderCell>
                  <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-muted-foreground">No submitted non-urgent requests waiting for compilation.</TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><input type="checkbox" name="request_id" value={r.id} className="h-4 w-4" /></TableCell>
                    <TableCell>
                      <div className="font-medium">{r.description}</div>
                      <div className="font-sans text-xs text-muted-foreground">{humanize(r.category)}</div>
                    </TableCell>
                    <TableCell>{r.entity_name}</TableCell>
                    <TableCell>{r.needed_by_date ? shortDate(r.needed_by_date) : <span className="text-muted-foreground">Open</span>}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline">{money(r.amount, r.currency)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
