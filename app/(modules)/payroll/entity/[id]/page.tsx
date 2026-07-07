import Link from "next/link";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Sparkline,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { compactMoney, money } from "@/lib/format";
import { getEntityPayrollHistory, getStaff } from "@/lib/payroll";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

/** One entity's payroll world: analysis, monthly history, staff. Exportable. */
export default async function EntityPayrollPage({ params }: { params: { id: string } }) {
  const ctx = await requireUser();
  const inScope = ctx.isSuperAdmin || ctx.isAuditor || ctx.accessibleEntityIds.includes(params.id);
  if (!inScope) {
    return <div className="mx-auto max-w-3xl font-sans text-sm text-muted-foreground">Outside your scope.</div>;
  }
  const [entity] = await sql<{ name: string; type: string; functional_currency: string }[]>`
    select name, type::text, functional_currency from public.entities where id = ${params.id}`;
  if (!entity) {
    return <div className="mx-auto max-w-3xl font-sans text-sm text-muted-foreground">Entity not found.</div>;
  }

  const [history, staff] = await Promise.all([
    getEntityPayrollHistory(params.id),
    getStaff([params.id]),
  ]);

  const paidOrApproved = history.filter((h: Record<string, string>) =>
    ["approved", "paid"].includes(String(h.status))
  );
  const latest = paidOrApproved[0] as Record<string, string> | undefined;
  const prev = paidOrApproved[1] as Record<string, string> | undefined;
  const delta =
    latest && prev && Number(prev.net) > 0
      ? ((Number(latest.net) - Number(prev.net)) / Number(prev.net)) * 100
      : null;
  const spark = paidOrApproved
    .slice(0, 12)
    .map((h: Record<string, string>) => Number(h.net))
    .reverse();
  const ytd = paidOrApproved
    .filter((h: Record<string, string>) => Number(h.period_year) === new Date().getFullYear())
    .reduce((s: number, h: Record<string, string>) => s + Number(h.net), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Link href="/payroll" className="font-sans text-xs text-muted-foreground hover:text-ink">← Payroll</Link>
          <h2 className="font-display text-3xl tracking-display text-ink">{entity.name}</h2>
          <p className="font-sans text-sm text-muted-foreground">
            {humanize(entity.type)} · payroll history & analysis ({entity.functional_currency})
          </p>
        </div>
        <a
          href={`/payroll/entity/${params.id}/export`}
          className="inline-flex h-10 items-center rounded-md bg-cobalt px-4 font-sans text-sm font-semibold text-white shadow-card hover:bg-cobalt-dark"
        >
          Export spreadsheet
        </a>
      </div>

      {/* Analysis cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-paper-200/60 bg-surface p-4 shadow-card">
          <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Latest net payroll</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-2xl font-semibold text-ink" data-numeric>
              {latest ? compactMoney(Number(latest.net)) : "—"}
            </span>
            {delta !== null && (
              <span className={`font-sans text-xs font-semibold ${delta >= 0 ? "text-status-success" : "text-status-danger"}`}>
                {delta >= 0 ? "↑" : "↓"}{Math.abs(delta).toFixed(1)}%
              </span>
            )}
          </div>
          {latest && (
            <div className="mt-0.5 font-sans text-[11px] text-muted-foreground">
              {String(latest.period_month).padStart(2, "0")}/{latest.period_year} · vs prior month
            </div>
          )}
        </div>
        <div className="rounded-lg border border-paper-200/60 bg-surface p-4 shadow-card">
          <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Headcount</div>
          <div className="mt-1 font-display text-2xl font-semibold text-ink" data-numeric>
            {latest ? latest.headcount : staff.length}
          </div>
          <div className="mt-0.5 font-sans text-[11px] text-muted-foreground">{staff.length} on the register</div>
        </div>
        <div className="rounded-lg border border-paper-200/60 bg-surface p-4 shadow-card">
          <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Net paid YTD</div>
          <div className="mt-1 font-display text-2xl font-semibold text-ink" data-numeric>{compactMoney(ytd)}</div>
          <div className="mt-0.5 font-sans text-[11px] text-muted-foreground">{new Date().getFullYear()} approved/paid runs</div>
        </div>
        <div className="rounded-lg border border-paper-200/60 bg-surface p-4 shadow-card">
          <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">12-month trend</div>
          <div className="mt-2">
            {spark.length > 1 ? <Sparkline data={spark} width={140} height={36} /> :
              <span className="font-sans text-xs text-muted-foreground">Not enough history</span>}
          </div>
        </div>
      </div>

      {/* Monthly history */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly payroll history</CardTitle>
          <CardDescription>Every run; click a period for its full detail</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Period</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Headcount</TableHeaderCell>
                <TableHeaderCell className="text-right">Gross</TableHeaderCell>
                <TableHeaderCell className="text-right">PAYE</TableHeaderCell>
                <TableHeaderCell className="text-right">Pension</TableHeaderCell>
                <TableHeaderCell className="text-right">Net</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((h: Record<string, string>) => (
                <TableRow key={h.id}>
                  <TableCell>
                    <Link href={`/payroll/runs/${h.id}`} className="font-medium text-ink hover:underline">
                      {String(h.period_month).padStart(2, "0")}/{h.period_year}
                    </Link>
                  </TableCell>
                  <TableCell><Badge variant="outline">{humanize(h.status)}</Badge></TableCell>
                  <TableCell className="text-right">{h.headcount}</TableCell>
                  <TableCell className="text-right">{money(h.gross)}</TableCell>
                  <TableCell className="text-right">{money(h.paye)}</TableCell>
                  <TableCell className="text-right">{money(h.pension)}</TableCell>
                  <TableCell className="text-right font-medium">{money(h.net)}</TableCell>
                </TableRow>
              ))}
              {history.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-muted-foreground">No payroll runs for this entity yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Staff */}
      <Card>
        <CardHeader>
          <CardTitle>Staff register</CardTitle>
          <CardDescription>{staff.length} staff attached to this entity</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Tax state</TableHeaderCell>
                <TableHeaderCell className="text-right">Monthly compensation</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {staff.map((s: Record<string, string>) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.full_name}</TableCell>
                  <TableCell><Badge variant="outline">{humanize(s.staff_type)}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{s.state_of_taxation ?? "default"}</TableCell>
                  <TableCell className="text-right">{money(s.gross_compensation)}</TableCell>
                </TableRow>
              ))}
              {staff.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-muted-foreground">No staff records.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
