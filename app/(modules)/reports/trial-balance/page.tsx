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
import { humanize } from "@/lib/enums";
import { money } from "@/lib/format";
import { getTrialBalance } from "@/lib/ledgerReports";

export const dynamic = "force-dynamic";

/**
 * Trial balance — level 1 of the drill-down report writer. Every account row
 * opens the journal entries composing it; every entry opens its lines and
 * source documents. If debits ≠ credits here, something is deeply wrong —
 * the ledger triggers make that impossible.
 */
export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? ("all" as const) : ctx.accessibleEntityIds;
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const from = String(searchParams?.from ?? yearStart);
  const to = String(searchParams?.to ?? today);
  const includeClosing = searchParams?.closing === "1";

  const rows = await getTrialBalance(scope, from, to, includeClosing);
  const totals = rows.reduce(
    (acc, r) => ({ debit: acc.debit + Number(r.debit_ngn), credit: acc.credit + Number(r.credit_ngn) }),
    { debit: 0, credit: 0 }
  );
  const balanced = Math.abs(totals.debit - totals.credit) < 0.01;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <Link href="/reports" className="font-sans text-xs text-muted-foreground hover:text-ink">
            ← Reports
          </Link>
          <h2 className="font-display text-3xl tracking-display text-ink">Trial balance</h2>
          <p className="font-sans text-sm text-muted-foreground">
            Presentation currency (NGN). Click any account to open the entries behind the number.
          </p>
        </div>
        <Badge variant={balanced ? "outline" : "solid"}>
          {balanced ? "Balanced" : "OUT OF BALANCE"}
        </Badge>
      </div>

      <Card>
        <CardContent className="py-4">
          <form className="flex flex-wrap items-end gap-3" method="get">
            <label className="space-y-1">
              <span className="block font-sans text-xs font-semibold text-muted-foreground">From</span>
              <input type="date" name="from" defaultValue={from}
                className="h-10 rounded-md border border-paper-300 bg-paper px-3 font-sans text-sm" />
            </label>
            <label className="space-y-1">
              <span className="block font-sans text-xs font-semibold text-muted-foreground">To</span>
              <input type="date" name="to" defaultValue={to}
                className="h-10 rounded-md border border-paper-300 bg-paper px-3 font-sans text-sm" />
            </label>
            <label className="flex h-10 items-center gap-2 rounded-md border border-paper-300 px-3 font-sans text-sm">
              <input type="checkbox" name="closing" value="1" defaultChecked={includeClosing} className="h-4 w-4" />
              Include year-end closing entries
            </label>
            <button className="h-10 rounded-md border border-ink bg-ink px-4 font-sans text-sm font-bold text-paper">
              Run
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {from} → {to}
          </CardTitle>
          <CardDescription>{rows.length} accounts with activity</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Account</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell className="text-right">Debits</TableHeaderCell>
                <TableHeaderCell className="text-right">Credits</TableHeaderCell>
                <TableHeaderCell className="text-right">Net</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.account_id}>
                  <TableCell>
                    <Link
                      href={`/reports/ledger/${r.account_id}?from=${from}&to=${to}`}
                      className="font-medium text-ink underline-offset-2 hover:underline"
                    >
                      <span className="font-mono text-xs">{r.account_code}</span> {r.account_name}
                    </Link>
                    <div className="font-sans text-xs text-muted-foreground">{r.line_count.toLocaleString()} lines</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{humanize(r.account_type)}</Badge></TableCell>
                  <TableCell className="text-right">{money(r.debit_ngn)}</TableCell>
                  <TableCell className="text-right">{money(r.credit_ngn)}</TableCell>
                  <TableCell className="text-right font-medium">{money(r.net_ngn)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-bold">Totals</TableCell>
                <TableCell></TableCell>
                <TableCell className="text-right font-bold">{money(String(totals.debit))}</TableCell>
                <TableCell className="text-right font-bold">{money(String(totals.credit))}</TableCell>
                <TableCell className={`text-right font-bold ${balanced ? "text-status-success" : "text-status-danger"}`}>
                  {money(String(totals.debit - totals.credit))}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
