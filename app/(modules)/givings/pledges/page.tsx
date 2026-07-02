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
import { requireUser } from "@/lib/auth";
import { getEntities } from "@/lib/repo";
import { getPledgeAging, searchGivers } from "@/lib/givings";
import { humanize } from "@/lib/enums";
import { compactMoney, shortDate } from "@/lib/format";
import { CreatePledgeForm } from "../_components/CreatePledgeForm";
import { PledgePaymentForm } from "../_components/PledgePaymentForm";

export const dynamic = "force-dynamic";

const BUCKET_STYLE: Record<string, string> = {
  "90+": "bg-status-danger-bg text-status-danger border-status-danger/25",
  "61-90": "bg-status-danger-bg text-status-danger border-status-danger/25",
  "31-60": "bg-status-warning-bg text-status-warning border-status-warning/25",
  "1-30": "bg-status-warning-bg text-status-warning border-status-warning/25",
  current: "bg-status-success-bg text-status-success border-status-success/25",
  no_due_date: "bg-status-neutral-bg text-status-neutral border-status-neutral/20",
  fulfilled: "bg-ink text-paper border-ink",
};

export default async function PledgesPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const canWriteScope = ctx.isSuperAdmin || ctx.roles.some((r) => r.role !== "auditor");

  const [aging, entitiesRaw, givers] = await Promise.all([
    getPledgeAging(scope),
    getEntities(ctx.isSuperAdmin ? "all" : ctx.accessibleEntityIds),
    searchGivers(""),
  ]);
  const entities = entitiesRaw.map((e) => ({
    id: e.id,
    name: e.name,
    functional_currency: e.functional_currency,
  }));

  const canWriteRow = (entityId: string) =>
    ctx.isSuperAdmin ||
    (ctx.accessibleEntityIds.includes(entityId) &&
      ctx.roles.some((r) => r.role !== "auditor"));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="space-y-0.5">
        <Link href="/givings" className="font-sans text-xs text-muted-foreground hover:text-ink">
          ← Givings
        </Link>
        <h2 className="font-display text-2xl tracking-display text-ink">Pledges & Vows</h2>
        <p className="font-sans text-xs text-muted-foreground">
          Outstanding pledges are receivables, aged against the target fulfilment date (AR-style).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aging report</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Giver</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell className="text-right">Pledged</TableHeaderCell>
                <TableHeaderCell className="text-right">Outstanding</TableHeaderCell>
                <TableHeaderCell>Due</TableHeaderCell>
                <TableHeaderCell>Aging</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {aging.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    No pledges yet.
                  </TableCell>
                </TableRow>
              )}
              {aging.map((p: Record<string, string | number>) => {
                const outstanding = Number(p.outstanding_amount);
                return (
                  <TableRow key={p.pledge_id as string}>
                    <TableCell className="font-medium">{p.giver_name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{p.entity_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{humanize(p.pledge_type as string)}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {compactMoney(p.total_pledged_amount as string, p.currency as string)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {compactMoney(p.outstanding_amount as string, p.currency as string)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {shortDate((p.target_fulfillment_date as string) ?? null)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          "inline-flex rounded-full border px-2 py-0.5 font-sans text-[11px] " +
                          (BUCKET_STYLE[p.aging_bucket as string] ?? BUCKET_STYLE.no_due_date)
                        }
                      >
                        {humanize(p.aging_bucket as string)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {outstanding > 0 && canWriteRow(p.entity_id as string) && (
                        <PledgePaymentForm pledgeId={p.pledge_id as string} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canWriteScope && entities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>New pledge</CardTitle>
          </CardHeader>
          <CardContent>
            <CreatePledgeForm entities={entities} givers={givers} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
