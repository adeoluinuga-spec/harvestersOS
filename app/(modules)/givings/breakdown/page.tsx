import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getGivingBreakdown, getNlpInflow, getWeeklyGiving, getYearGivingTotalNgn } from "@/lib/givingAnalytics";
import { compactMoney } from "@/lib/format";
import { GivingTree } from "@/components/givings/GivingTree";
import { InflowCharts } from "@/components/givings/GivingCharts";

export const dynamic = "force-dynamic";

export default async function GivingBreakdownPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;

  const [tree, nlp, year, weekly] = await Promise.all([
    getGivingBreakdown(scope),
    getNlpInflow(),
    getYearGivingTotalNgn(scope),
    getWeeklyGiving(scope),
  ]);

  const nodes = [...tree.groups, ...tree.ministries];
  const chan = nodes.reduce(
    (a, n) => ({
      bank_transfer: a.bank_transfer + n.metrics.bank_transfer,
      pos: a.pos + n.metrics.pos,
      cash: a.cash + n.metrics.cash,
      online: a.online + n.metrics.online,
    }),
    { bank_transfer: 0, pos: 0, cash: 0, online: 0 }
  );
  const channelCards = [
    { label: "Bank transfer", value: chan.bank_transfer },
    { label: "POS", value: chan.pos },
    { label: "Cash deposit", value: chan.cash },
    { label: "Online / USSD", value: chan.online },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <Link href="/givings" className="font-sans text-xs text-muted-foreground hover:text-ink">← Givings</Link>
          <h2 className="font-display text-2xl tracking-display text-ink">Giving breakdown & analytics</h2>
          <p className="font-sans text-sm text-muted-foreground">
            By group → sub-group → campus and by characteristic. Click any entity for MoM / YoY / Week-on-Week analytics.
          </p>
        </div>
        <div className="flex gap-4">
          <div>
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-muted-foreground">This week</div>
            <div className="font-display text-lg tracking-display text-ink">{compactMoney(weekly.totalNgn)}</div>
          </div>
          <div>
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Year to date</div>
            <div className="font-display text-lg tracking-display text-ink">{compactMoney(year.ngn)}</div>
          </div>
        </div>
      </div>

      {/* Channel mix */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {channelCards.map((c) => (
          <Card key={c.label}>
            <CardContent className="py-3">
              <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{c.label}</div>
              <div className="mt-1 font-display text-lg tracking-display text-ink">{compactMoney(c.value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Hierarchy */}
      <Card>
        <CardHeader><CardTitle>By group → sub-group → campus (year to date)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <GivingTree groups={tree.groups} ministries={tree.ministries} />
        </CardContent>
      </Card>

      {/* NLP daily/weekly inflow */}
      {nlp && (nlp.daily.length > 0 || nlp.weekly.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-end justify-between">
            <h3 className="font-display text-lg tracking-display text-ink">Next Level Prayers — inflow</h3>
            <Link href={`/givings/breakdown/${nlp.entityId}`} className="font-sans text-xs text-muted-foreground hover:text-ink">Full analytics →</Link>
          </div>
          <InflowCharts daily={nlp.daily} weekly={nlp.weekly} />
        </div>
      )}
    </div>
  );
}
