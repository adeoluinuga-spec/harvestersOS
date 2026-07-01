import Link from "next/link";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { analyticsScope, getAnalyticsDashboard } from "@/lib/analytics";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const ctx = await requireUser();
  const dashboard = await getAnalyticsDashboard(analyticsScope(ctx));

  const totalGiving = dashboard.monthly.reduce(
    (sum, row) => sum + Number(row.total_amount ?? 0),
    0
  );
  const careDrops = dashboard.careAlerts.filter((row) => row.alert_kind === "drop").length;
  const cashShort = dashboard.cashFlow.filter((row) => row.likely_short_before_payroll).length;
  const expenseFlags = dashboard.expenseFlags.length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="font-display text-3xl tracking-display text-ink">Analytics</h2>
          <p className="font-sans text-sm text-muted-foreground">
            Ledger-derived trends, pastoral care alerts, donor insights, cash forecasting, and expense pattern review.
          </p>
        </div>
        <Link
          href="/analytics/query"
          className="inline-flex h-10 items-center justify-center rounded border border-ink bg-ink px-4 font-sans text-sm font-medium text-paper transition-colors hover:bg-ink-800"
        >
          Ask the ledger
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Recent giving" value={money(totalGiving, "NGN")} />
        <Metric label="Care alerts" value={String(dashboard.careAlerts.length)} sub={`${careDrops} giving drops`} />
        <Metric label="Cash short risk" value={String(cashShort)} sub="before payroll" />
        <Metric label="Expense flags" value={String(expenseFlags)} sub="last 180 days" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Giving trend by entity</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead><TableRow><TableHeaderCell>Month/entity</TableHeaderCell><TableHeaderCell>Type</TableHeaderCell><TableHeaderCell className="text-right">Amount</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {dashboard.monthly.map((row) => (
                  <TableRow key={`${row.month_start}-${row.entity_id}-${row.giving_type_code}`}>
                    <TableCell><div className="font-medium">{row.entity_name}</div><div className="font-sans text-xs text-muted-foreground">{shortDate(String(row.month_start))} | {row.gift_count} gifts | {row.giver_count} givers</div></TableCell>
                    <TableCell>{humanize(String(row.giving_type_code))}</TableCell>
                    <TableCell className="text-right">{money(String(row.total_amount), String(row.currency ?? "NGN"))}</TableCell>
                  </TableRow>
                ))}
                {dashboard.monthly.length === 0 && <EmptyRow colSpan={3} label="No giving trends yet." />}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Year-over-year comparison</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead><TableRow><TableHeaderCell>Entity/month</TableHeaderCell><TableHeaderCell className="text-right">Current</TableHeaderCell><TableHeaderCell className="text-right">YoY</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {dashboard.yoy.map((row) => (
                  <TableRow key={`${row.entity_id}-${row.giving_year}-${row.giving_month}-${row.giving_type_code}`}>
                    <TableCell><div className="font-medium">{row.entity_name}</div><div className="font-sans text-xs text-muted-foreground">{row.giving_month}/{row.giving_year} | {humanize(String(row.giving_type_code))}</div></TableCell>
                    <TableCell className="text-right">{money(String(row.total_amount), String(row.currency ?? "NGN"))}</TableCell>
                    <TableCell className="text-right">{row.yoy_change_percent === null ? "-" : `${row.yoy_change_percent}%`}</TableCell>
                  </TableRow>
                ))}
                {dashboard.yoy.length === 0 && <EmptyRow colSpan={3} label="No YoY comparison yet." />}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Pastoral care opportunities</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.careAlerts.map((row) => (
              <InsightItem key={`${row.subject_type}-${row.giver_id ?? row.entity_id}-${row.currency}`} title={String(row.subject_name)}>
                <div className="flex items-center justify-between gap-3">
                  <span>{row.entity_name}</span>
                  <Badge variant={row.alert_kind === "drop" ? "solid" : "outline"}>{humanize(String(row.alert_kind))}</Badge>
                </div>
                <div>{row.pastoral_care_message}</div>
                <div>{money(String(row.current_amount), String(row.currency ?? "NGN"))} now vs {money(String(row.previous_amount), String(row.currency ?? "NGN"))} prior</div>
              </InsightItem>
            ))}
            {dashboard.careAlerts.length === 0 && <Muted>No giving velocity alerts currently.</Muted>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>HNI relationship view</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.hniGivers.map((row) => (
              <InsightItem key={`${row.giver_id}-${row.currency}`} title={String(row.full_name)}>
                <div>{row.entity_name ?? "No primary entity"}</div>
                <div>{money(String(row.lifetime_amount), String(row.currency ?? "NGN"))} lifetime | {row.gift_count} gifts</div>
                <div>Last gift: {shortDate(String(row.last_gift_date))}</div>
              </InsightItem>
            ))}
            {dashboard.hniGivers.length === 0 && <Muted>No HNI giver signal yet.</Muted>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Lapsed major givers</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.lapsedGivers.map((row) => (
              <InsightItem key={`${row.giver_id}-${row.currency}`} title={String(row.full_name)}>
                <div>{row.lapse_reason}</div>
                <div>{money(String(row.lifetime_amount), String(row.currency ?? "NGN"))} lifetime</div>
                <div>Last gift: {shortDate(String(row.last_gift_date))}</div>
              </InsightItem>
            ))}
            {dashboard.lapsedGivers.length === 0 && <Muted>No lapsed major givers flagged.</Muted>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Cash-flow forecast</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead><TableRow><TableHeaderCell>Entity</TableHeaderCell><TableHeaderCell className="text-right">Projected net</TableHeaderCell><TableHeaderCell>Payroll risk</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {dashboard.cashFlow.map((row) => (
                  <TableRow key={`${row.entity_id}-${row.currency}`}>
                    <TableCell><div className="font-medium">{row.entity_name}</div><div className="font-sans text-xs text-muted-foreground">Payroll {shortDate(String(row.next_payroll_date))} | est. {money(String(row.next_payroll_estimate), String(row.currency ?? "NGN"))}</div></TableCell>
                    <TableCell className="text-right">{money(String(row.projected_30_day_net), String(row.currency ?? "NGN"))}</TableCell>
                    <TableCell><Badge variant={row.likely_short_before_payroll ? "solid" : "outline"}>{row.likely_short_before_payroll ? "Likely short" : "Watch"}</Badge></TableCell>
                  </TableRow>
                ))}
                {dashboard.cashFlow.length === 0 && <EmptyRow colSpan={3} label="No cash-flow forecast yet." />}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Expense anomaly flags</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead><TableRow><TableHeaderCell>Expense</TableHeaderCell><TableHeaderCell>Flag</TableHeaderCell><TableHeaderCell className="text-right">Amount</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {dashboard.expenseFlags.map((row) => (
                  <TableRow key={`${row.source_id}-${row.flag_type}`}>
                    <TableCell><div className="font-medium">{row.vendor_name ?? row.category}</div><div className="font-sans text-xs text-muted-foreground">{row.entity_name} | {shortDate(String(row.transaction_date))}</div></TableCell>
                    <TableCell><div>{humanize(String(row.flag_type))}</div><div className="font-sans text-xs text-muted-foreground">{row.flag_reason}</div></TableCell>
                    <TableCell className="text-right">{money(String(row.amount), String(row.currency ?? "NGN"))}</TableCell>
                  </TableRow>
                ))}
                {dashboard.expenseFlags.length === 0 && <EmptyRow colSpan={3} label="No expense anomalies flagged." />}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Seasonal giving patterns</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {dashboard.seasonality.slice(0, 16).map((row) => (
            <div key={`${row.entity_id}-${row.giving_month}-${row.currency}`} className="rounded border border-paper-200 p-3">
              <div className="font-sans text-xs uppercase text-muted-foreground">{row.month_label}</div>
              <div className="mt-1 font-medium text-ink">{row.entity_name}</div>
              <div className="font-sans text-sm text-muted-foreground">{money(String(row.average_monthly_amount), String(row.currency ?? "NGN"))} avg</div>
            </div>
          ))}
          {dashboard.seasonality.length === 0 && <Muted>No seasonality data yet.</Muted>}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent>
        <div className="font-sans text-xs uppercase text-muted-foreground">{label}</div>
        <div className="mt-2 font-display text-2xl tracking-display text-ink">{value}</div>
        {sub && <div className="mt-1 font-sans text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function InsightItem({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-paper-200 pb-3 last:border-0">
      <div className="font-medium text-ink">{title}</div>
      <div className="mt-1 space-y-1 font-sans text-xs text-muted-foreground">{children}</div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div className="font-sans text-sm text-muted-foreground">{children}</div>;
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-muted-foreground">
        {label}
      </TableCell>
    </TableRow>
  );
}
