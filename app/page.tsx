import Link from "next/link";
import {
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  FileBarChart2,
  Globe2,
  HandCoins,
  Landmark,
  LineChart,
  LockKeyhole,
  PiggyBank,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
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
import { money, shortDate } from "@/lib/format";
import { NAV_SECTIONS } from "@/lib/navigation";
import { getExecutiveDashboard, type ReportRow } from "@/lib/reporting";

export const dynamic = "force-dynamic";

const MODULE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "/givings": HandCoins,
  "/expenses": ReceiptText,
  "/payroll": UsersRound,
  "/budgeting": BarChart3,
  "/funds": PiggyBank,
  "/events": CalendarDays,
  "/next-level-prayers": Sparkles,
  "/international": Globe2,
  "/governance": ShieldCheck,
  "/reconciliation": Landmark,
  "/analytics": LineChart,
  "/reports": FileBarChart2,
  "/admin": LockKeyhole,
};

export default async function DashboardPage() {
  const ctx = await requireUser();
  const modules = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => i.href !== "/");

  if (!ctx.isSuperAdmin) {
    return <ModuleLauncher modules={modules} />;
  }

  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const dashboard = await getExecutiveDashboard(ctx, yearStart, today);
  const metric = (key: string) => dashboard.snapshot.find((m) => m.metric_key === key);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="relative overflow-hidden rounded-xl bg-ink px-6 py-7 text-paper shadow-lift sm:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(200,169,106,0.28),transparent_24rem)]" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-champagne">
            Harvesters International Christian Centre
          </div>
          <h2 className="font-display text-5xl font-semibold tracking-display text-paper">Executive dashboard</h2>
          <p className="max-w-3xl font-sans text-sm leading-relaxed text-paper/68">
            Consolidated giving, budget health, fund stewardship, approvals, compliance attention, and investment maturities.
          </p>
        </div>
        <Link href="/reports" className="inline-flex h-11 items-center gap-2 rounded-md border border-champagne/55 bg-paper px-4 font-sans text-sm font-bold text-ink shadow-lift transition-all hover:-translate-y-0.5">
          Build board report
          <ArrowUpRight className="h-4 w-4" />
        </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <Metric label="Consolidated giving" row={metric("consolidated_giving")} moneyValue />
        <Metric label="Budget variance" row={metric("budget_variance")} moneyValue />
        <Metric label="Restricted funds" row={metric("restricted_fund_balances")} moneyValue />
        <Metric label="My approvals" row={metric("pending_approvals")} />
        <Metric label="Compliance flags" row={metric("compliance_flags")} />
        <Metric label="Maturities" row={metric("investment_maturities")} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Group budget vs actual</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead><TableRow><TableHeaderCell>Group</TableHeaderCell><TableHeaderCell className="text-right">Approved</TableHeaderCell><TableHeaderCell className="text-right">Actual</TableHeaderCell><TableHeaderCell className="text-right">Variance</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {dashboard.budgetRows.map((row) => (
                  <TableRow key={`${row.entity_id}-${row.fund_classification}`}>
                    <TableCell><div className="font-medium">{row.entity_name}</div><div className="font-sans text-xs text-muted-foreground">{humanize(String(row.fund_classification))}</div></TableCell>
                    <TableCell className="text-right">{money(String(row.approved_amount), "NGN")}</TableCell>
                    <TableCell className="text-right">{money(String(row.actual_amount), "NGN")}</TableCell>
                    <TableCell className="text-right">{money(String(row.variance_amount), "NGN")}</TableCell>
                  </TableRow>
                ))}
                {dashboard.budgetRows.length === 0 && <EmptyRow colSpan={4} label="No group budget rows yet." />}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Pending approvals awaiting you</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead><TableRow><TableHeaderCell>Request</TableHeaderCell><TableHeaderCell>Role</TableHeaderCell><TableHeaderCell className="text-right">Amount</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {dashboard.pendingApprovals.map((row) => (
                  <TableRow key={String(row.id)}>
                    <TableCell><div className="font-medium">{row.description}</div><div className="font-sans text-xs text-muted-foreground">{row.entity_name}</div></TableCell>
                    <TableCell><Badge variant={row.is_board_step ? "solid" : "outline"}>{humanize(String(row.approver_role))}</Badge></TableCell>
                    <TableCell className="text-right">{money(String(row.amount), String(row.currency ?? "NGN"))}</TableCell>
                  </TableRow>
                ))}
                {dashboard.pendingApprovals.length === 0 && <EmptyRow colSpan={3} label="No approvals waiting on you." />}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Restricted fund balances</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.restrictedFunds.map((row) => (
              <SummaryItem key={String(row.id)} title={String(row.name)}>
                <div>{row.entity_name}</div>
                <div>{money(String(row.current_balance), "NGN")} of {money(String(row.target_amount), "NGN")}</div>
                <div>{row.percent_funded ?? "-"}% funded</div>
              </SummaryItem>
            ))}
            {dashboard.restrictedFunds.length === 0 && <Muted>No restricted fund balances yet.</Muted>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Compliance attention</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.complianceFlags.map((row, index) => (
              <SummaryItem key={`${row.flag_type}-${index}`} title={String(row.flag_type)}>
                <div>{row.entity_name}</div>
                <div>{money(String(row.amount), String(row.currency ?? "NGN"))}</div>
                <div>{shortDate(String(row.flag_date))}</div>
              </SummaryItem>
            ))}
            {dashboard.complianceFlags.length === 0 && <Muted>No compliance flags requiring attention.</Muted>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Upcoming investment maturities</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.maturities.map((row) => (
              <SummaryItem key={String(row.id)} title={String(row.institution)}>
                <div>{row.entity_name} | {humanize(String(row.investment_type))}</div>
                <div>{money(String(row.principal_amount), String(row.currency ?? "NGN"))}</div>
                <div>{shortDate(String(row.maturity_date))} | {row.days_to_maturity} days</div>
              </SummaryItem>
            ))}
            {dashboard.maturities.length === 0 && <Muted>No investments maturing in 30 days.</Muted>}
          </CardContent>
        </Card>
      </section>

      <ModuleLauncher modules={modules} compact />
    </div>
  );
}

function Metric({
  label,
  row,
  moneyValue,
}: {
  label: string;
  row?: ReportRow;
  moneyValue?: boolean;
}) {
  const raw = Number(row?.metric_value ?? 0);
  const value = moneyValue ? money(raw, String(row?.currency ?? "NGN")) : String(raw);
  return (
    <Card>
      <CardContent>
        <div className="font-sans text-xs uppercase text-muted-foreground">{label}</div>
        <div className="mt-2 font-display text-2xl tracking-display text-ink">{value}</div>
        {row?.severity && row.severity !== "normal" && (
          <Badge className="mt-2" variant="solid">{humanize(String(row.severity))}</Badge>
        )}
      </CardContent>
    </Card>
  );
}

function ModuleLauncher({
  modules,
  compact,
}: {
  modules: Array<{ href: string; label: string; glyph: string }>;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "space-y-4" : "mx-auto max-w-5xl space-y-8"}>
      {!compact && (
        <section className="space-y-3">
          <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-champagne-dark">
            Harvesters International Christian Centre
          </div>
          <h2 className="font-display text-5xl font-semibold tracking-display text-ink">Finance OS</h2>
          <p className="max-w-2xl font-sans text-sm leading-relaxed text-muted-foreground">
            A ledger-grade financial operating system. Every module posts to one immutable, append-only double-entry ledger.
          </p>
        </section>
      )}
      <section className="space-y-4">
        <h3 className="font-display text-lg tracking-display text-ink">Modules</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <Link key={m.href} href={m.href} className="group">
              <Card className="h-full overflow-hidden transition-all duration-200 group-hover:-translate-y-1 group-hover:border-champagne group-hover:shadow-lift">
                <CardHeader className="border-b-0 pb-0">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-champagne/35 bg-champagne-light text-ink shadow-card">
                      {(() => {
                        const Icon = MODULE_ICONS[m.href] ?? Building2;
                        return <Icon className="h-5 w-5" />;
                      })()}
                    </span>
                    <CardTitle className="text-xl">{m.label}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between pt-3">
                  <CardDescription>Open module</CardDescription>
                  <ArrowUpRight className="h-4 w-4 text-champagne-dark transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function SummaryItem({ title, children }: { title: string; children: React.ReactNode }) {
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
      <TableCell colSpan={colSpan} className="text-muted-foreground">{label}</TableCell>
    </TableRow>
  );
}
