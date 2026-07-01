import Link from "next/link";
import { notFound } from "next/navigation";
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
import { getGiver, getGiverHistory, getGiverTotals } from "@/lib/givings";
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Giver profile + unified giving history across all entities. This is also the
 * read-only "my giving history" view for a giver.
 */
export default async function GiverDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireUser();
  const giver = await getGiver(params.id);
  if (!giver) notFound();

  const [history, totals] = await Promise.all([
    getGiverHistory(params.id),
    getGiverTotals(params.id),
  ]);
  const year = new Date().getFullYear();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Link href="/givings/givers" className="font-sans text-xs text-muted-foreground hover:text-ink">
            ← Givers
          </Link>
          <h2 className="font-display text-3xl tracking-display text-ink">
            {giver.full_name}
          </h2>
          <p className="font-sans text-sm text-muted-foreground">
            {giver.phone ?? "no phone"} · {giver.email ?? "no email"}
          </p>
        </div>
        <Link
          href={`/givings/statements?giver=${giver.id}&year=${year}`}
          className="rounded border border-silver bg-paper px-3 py-2 font-sans text-xs text-ink hover:border-ink"
        >
          Giving statement →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By giving type</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {totals.byType.length === 0 && (
              <p className="font-sans text-sm text-muted-foreground">No giving yet.</p>
            )}
            {totals.byType.map((t: Record<string, string>, i: number) => (
              <div key={i} className="flex justify-between font-sans text-sm">
                <span className="text-ink-700">{t.name}</span>
                <span className="font-medium">{money(t.total, t.currency)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By entity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {totals.byEntity.map((t: Record<string, string>, i: number) => (
              <div key={i} className="flex justify-between font-sans text-sm">
                <span className="text-ink-700">{t.name}</span>
                <span className="font-medium">{money(t.total, t.currency)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Giving history</CardTitle>
          <div className="font-sans text-xs text-muted-foreground">
            {totals.grand
              .map((g: Record<string, string>) => `${money(g.total, g.currency)} · ${g.n} gifts`)
              .join("  ·  ")}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Channel</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Amount</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{shortDate(h.transaction_date)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{h.type_name}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{h.entity_name}</TableCell>
                  <TableCell className="text-muted-foreground">{humanize(h.channel)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {humanize(h.reconciliation_status)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {money(h.amount, h.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
