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
import { requireSuperAdmin } from "@/lib/auth";
import { getFiscalPeriods, getFiscalYearCloses } from "@/lib/periods";
import { compactMoney, shortDate } from "@/lib/format";
import { closePeriodAction, reopenPeriodAction } from "../actions";
import { PeriodTools } from "../_components/PeriodTools";

export const dynamic = "force-dynamic";

/**
 * Fiscal periods & year-end close. Posting is only possible into OPEN
 * periods (and never into the future); closing a period locks its month
 * permanently unless a super-admin explicitly reopens it. Once every period
 * of a year is closed, the year-end close sweeps income/expense into
 * Retained Earnings (3900).
 */
export default async function PeriodsPage() {
  await requireSuperAdmin();
  const [periods, yearCloses] = await Promise.all([
    getFiscalPeriods(),
    getFiscalYearCloses(),
  ]);
  const closedYears = new Set(yearCloses.map((y) => y.fiscal_year));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between">
        <div className="space-y-1">
          <Link href="/admin" className="font-sans text-xs text-muted-foreground hover:text-ink">
            ← Admin
          </Link>
          <h2 className="font-display text-3xl tracking-display text-ink">Accounting Periods</h2>
          <p className="max-w-2xl font-sans text-sm leading-relaxed text-muted-foreground">
            The ledger only accepts postings into open periods, never into the future.
            Close a month once its reconciliation is done; close the year to roll income
            and expense into retained earnings.
          </p>
        </div>
        <Badge variant="outline">{periods.filter((p) => p.status === "open").length} open</Badge>
      </div>

      <PeriodTools defaultThrough={today} />

      <Card>
        <CardHeader>
          <CardTitle>Periods</CardTitle>
          <CardDescription>Every month with ledger activity, newest first</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Period</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Entries</TableHeaderCell>
                <TableHeaderCell>Closed</TableHeaderCell>
                <TableHeaderCell className="text-right">Action</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {periods.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No periods yet — they are created automatically on first posting.
                  </TableCell>
                </TableRow>
              )}
              {periods.map((p) => {
                const yearClosed = closedYears.has(p.fiscal_year);
                const ended = p.period_end < today;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs font-semibold">{p.label}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "open" ? "outline" : "solid"}>
                        {p.status}
                        {yearClosed ? " · year closed" : ""}
                      </Badge>
                    </TableCell>
                    <TableCell>{p.entry_count.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.closed_at
                        ? `${shortDate(p.closed_at)}${p.closed_by_email ? ` · ${p.closed_by_email}` : ""}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.status === "open" && ended && (
                        <form action={closePeriodAction} className="inline">
                          <input type="hidden" name="period_start" value={p.period_start} />
                          <button className="rounded border border-ink px-3 py-1 font-sans text-xs font-semibold text-ink transition-colors hover:bg-ink hover:text-paper">
                            Close
                          </button>
                        </form>
                      )}
                      {p.status === "open" && !ended && (
                        <span className="font-sans text-xs text-muted-foreground">current</span>
                      )}
                      {p.status === "closed" && !yearClosed && (
                        <form action={reopenPeriodAction} className="inline">
                          <input type="hidden" name="period_start" value={p.period_start} />
                          <button className="rounded border border-paper-300 px-3 py-1 font-sans text-xs font-semibold text-muted-foreground transition-colors hover:border-ink hover:text-ink">
                            Reopen
                          </button>
                        </form>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Year-end closes</CardTitle>
          <CardDescription>Income & expense rolled to Retained Earnings (3900)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Fiscal year</TableHeaderCell>
                <TableHeaderCell>Closing entries</TableHeaderCell>
                <TableHeaderCell>Net income (NGN)</TableHeaderCell>
                <TableHeaderCell>Closed</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {yearCloses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    No fiscal year has been closed yet.
                  </TableCell>
                </TableRow>
              )}
              {yearCloses.map((y) => (
                <TableRow key={y.fiscal_year}>
                  <TableCell className="font-mono text-xs font-semibold">{y.fiscal_year}</TableCell>
                  <TableCell>{y.entries_created}</TableCell>
                  <TableCell>{compactMoney(Number(y.net_income_ngn ?? 0))}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {shortDate(y.closed_at)}
                    {y.closed_by_email ? ` · ${y.closed_by_email}` : ""}
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
