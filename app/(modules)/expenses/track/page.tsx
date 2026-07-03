import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { Pagination } from "@/components/Pagination";
import { requireUser } from "@/lib/auth";
import { getApprovalChains, getMyRequestsPaged } from "@/lib/requisitions";
import { TrackList, type TrackChainStep, type TrackRow } from "@/components/expenses/TrackList";
import { nudgeApprovalAction } from "../actions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 15;

export default async function TrackPage({
  searchParams,
}: {
  searchParams?: { budget?: string; page?: string };
}) {
  const ctx = await requireUser();
  const page = Math.max(1, Number(searchParams?.page) || 1);
  const { rows, total } = await getMyRequestsPaged(ctx.user.id, page, PAGE_SIZE);
  const chains = await getApprovalChains(rows.map((r) => String(r.id)));

  const trackRows: TrackRow[] = rows.map((r) => ({
    id: String(r.id),
    description: String(r.description),
    category: String(r.category),
    entity: String(r.entity_name),
    status: String(r.status),
    urgent: Boolean(r.is_urgent),
    neededBy: r.needed_by_date ? String(r.needed_by_date) : null,
    net: Number(r.net_payable_amount ?? r.amount ?? 0),
    wht: Number(r.wht_withheld_amount ?? 0),
    currency: String(r.currency ?? "NGN"),
  }));
  const chainSteps: TrackChainStep[] = chains;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <Link href="/expenses" className="font-sans text-xs text-muted-foreground hover:text-ink">Back to requisitions</Link>
        <h2 className="font-display text-2xl tracking-display text-ink">Track my requests</h2>
        <p className="font-sans text-sm text-muted-foreground">
          Tap a request to see exactly where it is, whose approval is pending, and send a reminder.
        </p>
      </div>
      {searchParams?.budget === "warning" && (
        <p className="rounded border border-status-warning/30 bg-status-warning-bg px-3 py-2 font-sans text-sm text-status-warning">
          Budget warning: the submitted requisition is projected to exceed the approved budget line.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>My requisitions</CardTitle>
          <CardDescription>{total.toLocaleString()} total</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <TrackList rows={trackRows} chains={chainSteps} nudgeAction={nudgeApprovalAction} />
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/expenses/track" params={{}} />
        </CardContent>
      </Card>
    </div>
  );
}
