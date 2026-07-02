import Link from "next/link";
import {
  Badge, Card, CardContent, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow,
} from "@/components/ui";
import { KpiCard, BreakdownList } from "@/components/dashboard/Interactive";
import { requireUser } from "@/lib/auth";
import { getGivingSummary, getRecentGivings } from "@/lib/givings";
import { getWeeklyGiving, getYearGivingTotalNgn } from "@/lib/givingAnalytics";
import { humanize } from "@/lib/enums";
import { compactMoney, money, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/givings/record", label: "Record", desc: "Fast batch entry" },
  { href: "/givings/breakdown", label: "Breakdown", desc: "By group, characteristic, channel" },
  { href: "/givings/givers", label: "Givers", desc: "Search & history" },
  { href: "/givings/pledges", label: "Pledges", desc: "Receivables & aging" },
  { href: "/givings/duplicates", label: "Duplicates", desc: "Merge review" },
  { href: "/givings/statements", label: "Statements", desc: "Per-giver, per-year" },
];

export default async function GivingsPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;

  const [weekly, year, summary, recent] = await Promise.all([
    getWeeklyGiving(scope),
    getYearGivingTotalNgn(scope),
    getGivingSummary(scope),
    getRecentGivings(scope, 12),
  ]);

  const weeklyRows = [
    ...weekly.byCurrency.map((c) => ({ name: c.currency, value: compactMoney(c.ngn), sub: `${money(c.raw, c.currency)} · ${c.gifts} gifts` })),
    { name: "Year to date", value: compactMoney(year.ngn), sub: `${year.gifts.toLocaleString()} gifts` },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h2 className="font-display text-2xl tracking-display text-ink">Givings</h2>
        <p className="font-sans text-sm text-muted-foreground">
          Every gift posts to the immutable ledger and rolls up to one giver identity.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="This week's giving"
          display={compactMoney(weekly.totalNgn)}
          caption="Consolidated to NGN · last 7 days. Breakdown by currency below; open for full analysis."
          status="healthy"
          href="/givings/breakdown"
        >
          <BreakdownList rows={weeklyRows} />
        </KpiCard>
        <KpiCard label="Givers" display={summary.givers.toLocaleString()} caption="Unique givers with recorded giving." status="healthy" href="/givings/givers">
          <BreakdownList rows={[{ name: "Total givers", value: summary.givers.toLocaleString() }]} />
        </KpiCard>
        <KpiCard label="Active pledges" display={summary.activePledges.toLocaleString()} caption="Outstanding pledges tracked as receivables." status="healthy" href="/givings/pledges">
          <BreakdownList rows={[{ name: "Active pledges", value: summary.activePledges.toLocaleString() }]} />
        </KpiCard>
        <KpiCard
          label="Duplicates to review"
          display={summary.pendingDuplicates.toLocaleString()}
          caption="Potential duplicate givers flagged for merge."
          status={summary.pendingDuplicates > 0 ? "attention" : "healthy"}
          href="/givings/duplicates"
        >
          <BreakdownList rows={[{ name: "Pending review", value: summary.pendingDuplicates.toLocaleString() }]} />
        </KpiCard>
      </div>

      {/* Nav */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="group">
            <Card className="h-full transition-colors group-hover:border-ink">
              <CardContent className="py-3">
                <div className="font-sans text-sm font-semibold text-ink">{n.label}</div>
                <div className="mt-0.5 font-sans text-[11px] text-muted-foreground">{n.desc}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent giving</CardTitle>
          <Link href="/givings/record" className="font-sans text-xs text-muted-foreground hover:text-ink">Record →</Link>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Giver</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Channel</TableHeaderCell>
                <TableHeaderCell className="text-right">Amount</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {recent.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-muted-foreground">No giving recorded yet.</TableCell></TableRow>
              )}
              {recent.map((r: Record<string, string>) => (
                <TableRow key={r.id}>
                  <TableCell>{shortDate(r.transaction_date)}</TableCell>
                  <TableCell className="font-medium">{r.giver}</TableCell>
                  <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{r.entity}</TableCell>
                  <TableCell className="text-muted-foreground">{humanize(r.channel)}</TableCell>
                  <TableCell className="text-right font-medium">{money(r.amount, r.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
