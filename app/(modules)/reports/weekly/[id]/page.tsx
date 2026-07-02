import Link from "next/link";
import { Sparkles } from "lucide-react";
import {
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
import { compactMoney, money, shortDate } from "@/lib/format";
import { humanize } from "@/lib/enums";
import { getWeeklyIncomeReport } from "@/lib/weeklyIncomeReports";

export const dynamic = "force-dynamic";

export default async function WeeklyReportDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await requireUser();
  const report = await getWeeklyIncomeReport(params.id, ctx);
  if (!report) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card><CardContent>No report found in your scope.</CardContent></Card>
      </div>
    );
  }

  const data = report.generatedData as {
    campus: { name: string; currency: string };
    totals: { weekly_ngn: number; gift_count: number; giver_count: number };
    weekly: Array<{ giving_type: string; currency: string; channel: string; amount: number; amount_ngn: number; gift_count: number; giver_count: number }>;
    month_weeks: Array<{ week_start: string; week_end: string; amount_ngn: number; gift_count: number }>;
    target: { annual_target_ngn: number; target_to_date_ngn: number; achieved_ytd_ngn: number; achieved_percent: number; pace_percent: number };
  };
  const aiQuery = `Give strategic and pastoral-care interpretation for ${report.entityName}'s weekly income report for ${report.weekStart} to ${report.weekEnd}. Focus on weekly giving, target pace, member care opportunities, and concrete next actions.`;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="relative overflow-hidden rounded-xl bg-ink px-6 py-7 text-paper shadow-lift sm:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(200,169,106,0.28),transparent_24rem)]" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-champagne">
              Weekly income report
            </div>
            <h2 className="font-display text-4xl font-semibold tracking-display text-paper sm:text-5xl">
              {report.entityName}
            </h2>
            <p className="mt-1 font-sans text-sm text-paper/68">
              {shortDate(report.weekStart)} - {shortDate(report.weekEnd)}
            </p>
          </div>
          <Link
            href={`/analytics/query?q=${encodeURIComponent(aiQuery)}`}
            className="inline-flex h-11 items-center gap-2 rounded-md border border-champagne/55 bg-paper px-4 font-sans text-sm font-bold text-ink shadow-lift transition-all hover:-translate-y-0.5"
          >
            <Sparkles className="h-4 w-4" />
            AI analysis & interpretation
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Weekly giving" value={compactMoney(data.totals.weekly_ngn)} />
        <Metric label="Gifts" value={data.totals.gift_count.toLocaleString()} />
        <Metric label="Givers" value={data.totals.giver_count.toLocaleString()} />
        <Metric label="Target pace" value={`${data.target.pace_percent}%`} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>AI narrative</CardTitle>
            <CardDescription>Prepared for pastor and finance review.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 font-sans text-sm leading-relaxed text-ink-700">
            <p>{report.aiNarrative}</p>
            <p>{report.aiAnalysis}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Year target vs achieved</CardTitle>
            <CardDescription>Target from approved income budget lines.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <TargetLine label="Annual target" value={money(data.target.annual_target_ngn, "NGN")} />
            <TargetLine label="Target to date" value={money(data.target.target_to_date_ngn, "NGN")} />
            <TargetLine label="Achieved YTD" value={money(data.target.achieved_ytd_ngn, "NGN")} />
            <TargetLine label="Annual target achieved" value={`${data.target.achieved_percent}%`} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Weekly giving breakdown</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Type/channel</TableHeaderCell>
                  <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                  <TableHeaderCell className="text-right">Gifts</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.weekly.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <div className="font-medium">{humanize(row.giving_type)}</div>
                      <div className="font-sans text-xs text-muted-foreground">{humanize(row.channel)} | {row.currency}</div>
                    </TableCell>
                    <TableCell className="text-right">{money(row.amount, row.currency)}</TableCell>
                    <TableCell className="text-right">{row.gift_count}</TableCell>
                  </TableRow>
                ))}
                {data.weekly.length === 0 && <EmptyRow colSpan={3} label="No giving in this week." />}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Monthly report by weeks</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Week</TableHeaderCell>
                  <TableHeaderCell className="text-right">Giving</TableHeaderCell>
                  <TableHeaderCell className="text-right">Gifts</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.month_weeks.map((row) => (
                  <TableRow key={row.week_start}>
                    <TableCell>{shortDate(row.week_start)} - {shortDate(row.week_end)}</TableCell>
                    <TableCell className="text-right">{compactMoney(row.amount_ngn)}</TableCell>
                    <TableCell className="text-right">{row.gift_count}</TableCell>
                  </TableRow>
                ))}
                {data.month_weeks.length === 0 && <EmptyRow colSpan={3} label="No month-to-date giving." />}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent>
        <div className="font-sans text-xs uppercase text-muted-foreground">{label}</div>
        <div className="mt-2 font-display text-3xl font-semibold tracking-display text-ink">{value}</div>
      </CardContent>
    </Card>
  );
}

function TargetLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-paper-200 pb-2 last:border-0">
      <div className="font-sans text-sm text-muted-foreground">{label}</div>
      <div className="font-sans text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-muted-foreground">{label}</TableCell>
    </TableRow>
  );
}
