import Link from "next/link";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { money, shortDate } from "@/lib/format";
import { humanize } from "@/lib/enums";
import { getBatches, getRequests } from "@/lib/requisitions";

export const dynamic = "force-dynamic";

const links = [
  ["/expenses/request", "Request", "Individual requisition"],
  ["/expenses/compile", "Compile", "Batch submitted requests"],
  ["/expenses/approvals", "Approvals", "Role-based inbox"],
  ["/expenses/finance", "Finance", "Bank upload queue"],
  ["/expenses/signatures", "Signatures", "Slot confirmations"],
  ["/expenses/signature-admin", "Signature Admin", "Bank slot setup"],
  ["/expenses/track", "Track", "My requests"],
];

export default async function ExpensesPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const [requests, batches] = await Promise.all([getRequests(scope, 12), getBatches(scope)]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <h2 className="font-display text-3xl tracking-display text-ink">Requisitions</h2>
        <p className="font-sans text-sm text-muted-foreground">
          Request, compilation, approvals, finance processing, signatory confirmation, and final ledger posting.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
        {links.map(([href, label, desc]) => (
          <Link key={href} href={href} className="group">
            <Card className="h-full transition-colors group-hover:border-ink">
              <CardContent className="py-4">
                <div className="font-display text-sm tracking-display text-ink">{label}</div>
                <div className="mt-1 font-sans text-[11px] text-muted-foreground">{desc}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent requests</CardTitle>
              <CardDescription>Latest across your scope — track your own under Track</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/expenses/track" className="font-sans text-xs text-muted-foreground hover:text-ink">
                Track my requests →
              </Link>
              <Link href="/expenses/request" className="font-sans text-xs text-muted-foreground hover:text-ink">
                New request
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Request</TableHeaderCell>
                  <TableHeaderCell>Entity</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {requests.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-muted-foreground">No requisitions yet.</TableCell></TableRow>
                )}
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.description}</div>
                      <div className="font-sans text-xs text-muted-foreground">
                        {r.is_urgent ? "Urgent · " : ""}{humanize(r.category)}
                      </div>
                    </TableCell>
                    <TableCell>{r.entity_name}</TableCell>
                    <TableCell><Badge variant="outline">{humanize(r.status)}</Badge></TableCell>
                    <TableCell className="text-right font-medium">{money(r.amount, r.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Batches</CardTitle>
            <Link href="/expenses/compile" className="font-sans text-xs text-muted-foreground hover:text-ink">
              Compile
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {batches.slice(0, 6).map((b) => (
              <div key={b.id} className="border-b border-paper-200 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-sans text-sm font-medium">{b.entity_name}</div>
                  <Badge variant="outline">{humanize(b.status)}</Badge>
                </div>
                <div className="mt-1 font-sans text-xs text-muted-foreground">
                  {shortDate(b.batch_date)} · {b.item_count} items · {money(b.total_amount, b.currency)}
                </div>
              </div>
            ))}
            {batches.length === 0 && <p className="font-sans text-sm text-muted-foreground">No batches yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
