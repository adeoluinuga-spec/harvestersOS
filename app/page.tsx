import Link from "next/link";
import {
  ArrowUpRight, BarChart3, Building2, CalendarDays, FileBarChart2, Globe2,
  HandCoins, Landmark, LineChart, LockKeyhole, PiggyBank, ReceiptText,
  ShieldCheck, Sparkles, UsersRound,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { compactMoney, money, shortDate } from "@/lib/format";
import { NAV_SECTIONS } from "@/lib/navigation";
import { getExecutiveData } from "@/lib/dashboard";
import { getWeeklyGiving, getYearGivingTotalNgn } from "@/lib/givingAnalytics";
import { getGivingSummary } from "@/lib/givings";
import {
  ApprovalsPanel, BreakdownList, BudgetVsActual, DetailCard, KpiCard,
  type DetailItem,
} from "@/components/dashboard/Interactive";
import { DashboardCharts } from "@/components/dashboard/DashboardCharts";

export const dynamic = "force-dynamic";

const MODULE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "/givings": HandCoins, "/expenses": ReceiptText, "/payroll": UsersRound, "/budgeting": BarChart3,
  "/funds": PiggyBank, "/events": CalendarDays, "/next-level-prayers": Sparkles, "/international": Globe2,
  "/governance": ShieldCheck, "/reconciliation": Landmark, "/analytics": LineChart, "/reports": FileBarChart2,
  "/imports": FileBarChart2, "/admin": LockKeyhole,
};

export default async function DashboardPage() {
  const ctx = await requireUser();
  const modules = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => i.href !== "/");

  // Scope-aware home: super-admin/auditor get the org-wide executive dashboard;
  // every other cadre gets a scoped overview of the entities they can access.
  if (!ctx.isSuperAdmin && !ctx.isAuditor) {
    return <ScopedHome scope={ctx.accessibleEntityIds} modules={modules} />;
  }

  const d = await getExecutiveData(ctx);

  // KPI callout breakdown rows, per metric.
  const breakdown = (key: string): { name: string; value: string; sub?: string }[] => {
    switch (key) {
      case "consolidated_giving":
        return d.charts.givingByGroup.map((g) => ({ name: g.name, value: compactMoney(g.amount) }));
      case "budget_variance":
        return d.budgetByGroup.map((g) => ({ name: g.name, value: `${compactMoney(g.actual)} / ${compactMoney(g.approved)}`, sub: `${Math.round(g.ratio * 100)}% used` }));
      case "restricted_fund_balances":
        return d.fundProgress.map((f) => ({ name: f.entity, value: compactMoney(f.balance), sub: `${f.percent}% of ${compactMoney(f.target)}` }));
      case "pending_approvals":
        return d.approvals.byRole.map((r) => ({ name: humanize(r.name), value: `${r.cnt}`, sub: compactMoney(r.amount) }));
      case "compliance_flags": {
        const byType = new Map<string, number>();
        d.compliance.forEach((c) => byType.set(c.type, (byType.get(c.type) ?? 0) + 1));
        return Array.from(byType, ([name, n]) => ({ name, value: `${n} shown` }));
      }
      case "investment_maturities":
        return d.maturities.map((m) => ({ name: m.institution, value: money(m.amount, m.currency), sub: `${m.days} days · ${m.entity}` }));
      default:
        return [];
    }
  };

  const fundItems: DetailItem[] = d.fundProgress.map((f) => ({
    title: f.name,
    lines: [f.entity, `${money(f.balance)} of ${money(f.target)}`, `${f.percent}% funded`],
    severity: f.percent < 33 ? "high" : f.percent < 66 ? "medium" : "none",
    href: "/funds",
    aiQuery: `Analyse the ${f.name} restricted fund at ${f.entity}: current balance, funding progress toward target, and recent contribution trend.`,
  }));
  const complianceItems: DetailItem[] = d.compliance.map((c) => ({
    title: c.type,
    lines: [c.entity, money(c.amount, c.currency), shortDate(c.date)],
    severity: c.severity,
    href: "/governance",
  }));
  const maturityItems: DetailItem[] = d.maturities.map((m) => ({
    title: m.institution,
    lines: [`${m.entity} · ${humanize(m.type)}`, `${money(m.amount, m.currency)} principal`, `Matures ${shortDate(m.maturityDate)} · ${m.days} days`],
    severity: m.days <= 14 ? "high" : "medium",
    href: "/funds/investments",
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="relative overflow-hidden rounded-xl bg-ink px-6 py-7 text-paper shadow-lift sm:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(200,169,106,0.28),transparent_24rem)]" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-champagne">
              Harvesters International Christian Centre
            </div>
            <h2 className="font-display text-4xl font-semibold tracking-display text-paper sm:text-5xl">Executive dashboard</h2>
            <p className="max-w-3xl font-sans text-sm leading-relaxed text-paper/68">
              Consolidated giving, budget health, fund stewardship, approvals, compliance attention, and investment maturities — every figure clickable.
            </p>
          </div>
          <Link href="/reports" className="inline-flex h-11 items-center gap-2 rounded-md border border-champagne/55 bg-paper px-4 font-sans text-sm font-bold text-ink shadow-lift transition-all hover:-translate-y-0.5">
            Build board report <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* KPI cards */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {d.kpis.map((k) => (
          <KpiCard key={k.key} label={k.label} display={k.format === "money" ? compactMoney(k.value, k.currency) : k.value.toLocaleString()}
            caption={k.caption} status={k.status} href={k.href}>
            <BreakdownList rows={breakdown(k.key)} />
          </KpiCard>
        ))}
      </section>

      {/* Charts */}
      <DashboardCharts
        givingTrend={d.charts.givingTrend}
        incomeExpense={d.charts.incomeExpense}
        givingByGroup={d.charts.givingByGroup}
        fundProgress={d.charts.fundProgress}
      />

      {/* Budget vs actual + Approvals */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Group budget vs actual</CardTitle><CardDescription>Tap a group for detail</CardDescription></CardHeader>
          <CardContent className="p-0"><BudgetVsActual rows={d.budgetByGroup} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Approvals</CardTitle><CardDescription>Org-wide oversight & your personal queue</CardDescription></CardHeader>
          <CardContent className="p-0"><ApprovalsPanel all={d.approvals.all} mine={d.approvals.mine} /></CardContent>
        </Card>
      </section>

      {/* Restricted funds + Compliance + Maturities */}
      <section className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Restricted fund balances</CardTitle><CardDescription>Balance vs target · tap for AI analysis</CardDescription></CardHeader>
          <CardContent className="p-0"><DetailCard items={fundItems} emptyLabel="No restricted funds yet." href="/funds" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Compliance attention</CardTitle><CardDescription>By severity</CardDescription></CardHeader>
          <CardContent className="p-0"><DetailCard items={complianceItems} emptyLabel="No compliance flags." href="/governance" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Upcoming maturities</CardTitle><CardDescription>Investments maturing ≤45 days</CardDescription></CardHeader>
          <CardContent className="p-0"><DetailCard items={maturityItems} emptyLabel="No investments maturing soon." href="/funds/investments" /></CardContent>
        </Card>
      </section>

      <ModuleLauncher modules={modules} compact />
    </div>
  );
}

async function ScopedHome({ scope, modules }: { scope: string[]; modules: Array<{ href: string; label: string; glyph: string }> }) {
  if (scope.length === 0) return <ModuleLauncher modules={modules} />;
  const [weekly, year, summary] = await Promise.all([
    getWeeklyGiving(scope),
    getYearGivingTotalNgn(scope),
    getGivingSummary(scope),
  ]);
  const weeklyRows = weekly.byCurrency.map((c) => ({ name: c.currency, value: compactMoney(c.ngn), sub: `${c.gifts} gifts` }));
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="relative overflow-hidden rounded-xl bg-ink px-6 py-6 text-paper shadow-lift sm:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(200,169,106,0.24),transparent_22rem)]" />
        <div className="relative space-y-1">
          <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-champagne">Your overview</div>
          <h2 className="font-display text-3xl font-semibold tracking-display text-paper sm:text-4xl">Dashboard</h2>
          <p className="max-w-2xl font-sans text-sm text-paper/68">Scoped to the entities you oversee — every figure is clickable.</p>
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="This week's giving" display={compactMoney(weekly.totalNgn)} caption="Consolidated to NGN across your entities · last 7 days." status="healthy" href="/givings/breakdown">
          <BreakdownList rows={weeklyRows} />
        </KpiCard>
        <KpiCard label="Giving YTD" display={compactMoney(year.ngn)} caption="Year-to-date giving across your entities (NGN)." status="healthy" href="/givings/breakdown">
          <BreakdownList rows={[{ name: "Year to date", value: compactMoney(year.ngn), sub: `${year.gifts.toLocaleString()} gifts` }]} />
        </KpiCard>
        <KpiCard label="Active pledges" display={summary.activePledges.toLocaleString()} caption="Outstanding pledges in your entities." status="healthy" href="/givings/pledges">
          <BreakdownList rows={[{ name: "Active pledges", value: summary.activePledges.toLocaleString() }]} />
        </KpiCard>
        <KpiCard label="Givers" display={summary.givers.toLocaleString()} caption="Givers recorded across your entities." status="healthy" href="/givings/givers">
          <BreakdownList rows={[{ name: "Givers", value: summary.givers.toLocaleString() }]} />
        </KpiCard>
      </section>
      <ModuleLauncher modules={modules} compact />
    </div>
  );
}

function ModuleLauncher({ modules, compact }: { modules: Array<{ href: string; label: string; glyph: string }>; compact?: boolean }) {
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
          {modules.map((m) => {
            const Icon = MODULE_ICONS[m.href] ?? Building2;
            return (
              <Link key={m.href} href={m.href} className="group">
                <Card className="h-full overflow-hidden transition-all duration-200 group-hover:-translate-y-1 group-hover:border-champagne group-hover:shadow-lift">
                  <CardHeader className="border-b-0 pb-0">
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-champagne/35 bg-champagne-light text-ink shadow-card">
                        <Icon className="h-5 w-5" />
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
            );
          })}
        </div>
      </section>
    </div>
  );
}
