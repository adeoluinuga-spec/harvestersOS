import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getEntityGivingAnalytics } from "@/lib/givingAnalytics";
import { humanize } from "@/lib/enums";
import { compactMoney } from "@/lib/format";
import { EntityGivingCharts } from "@/components/givings/GivingCharts";

export const dynamic = "force-dynamic";

export default async function EntityGivingAnalyticsPage({ params }: { params: { id: string } }) {
  const ctx = await requireUser();
  const allowed = ctx.isSuperAdmin || ctx.isAuditor || ctx.accessibleEntityIds.includes(params.id);
  if (!allowed) notFound();

  const a = await getEntityGivingAnalytics(params.id);
  if (!a.entity) notFound();

  const ytd = a.channels.reduce((s, c) => s + c.amount, 0);
  const topType = a.types[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <Link href="/givings/breakdown" className="font-sans text-xs text-muted-foreground hover:text-ink">← Breakdown</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-2xl tracking-display text-ink">{a.entity.name}</h2>
          <div className="flex gap-5">
            <div>
              <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-muted-foreground">YTD giving</div>
              <div className="font-display text-lg tracking-display text-ink">{compactMoney(ytd)}</div>
            </div>
            {topType && (
              <div>
                <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Top type</div>
                <div className="font-display text-lg tracking-display text-ink">{topType.name}</div>
              </div>
            )}
            <div>
              <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Scope</div>
              <div className="font-display text-lg tracking-display text-ink">{humanize(a.entity.type)}</div>
            </div>
          </div>
        </div>
        <p className="font-sans text-sm text-muted-foreground">
          Consolidated to NGN, including all sub-entities. Month-on-month, week-on-week, and year-on-year.
        </p>
      </div>

      {ytd === 0 ? (
        <Card><CardContent className="py-10 text-center font-sans text-sm text-muted-foreground">No giving recorded for this entity yet.</CardContent></Card>
      ) : (
        <EntityGivingCharts mom={a.mom} wow={a.wow} yoy={a.yoy} channels={a.channels} />
      )}
    </div>
  );
}
