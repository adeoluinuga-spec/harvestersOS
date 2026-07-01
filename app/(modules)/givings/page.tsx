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
import { getGivingSummary, getRecentGivings } from "@/lib/givings";
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/givings/record", label: "Record Giving", desc: "Fast batch entry" },
  { href: "/givings/givers", label: "Givers", desc: "Search & unified history" },
  { href: "/givings/pledges", label: "Pledges", desc: "Receivables & aging" },
  { href: "/givings/duplicates", label: "Duplicates", desc: "Merge review queue" },
  { href: "/givings/statements", label: "Statements", desc: "Per-giver, per-year" },
];

export default async function GivingsPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;

  const [summary, recent] = await Promise.all([
    getGivingSummary(scope),
    getRecentGivings(scope, 12),
  ]);

  const yearTotal =
    summary.totals.map((t: Record<string, string>) => money(t.total, t.currency)).join(" · ") ||
    money(0);

  const stats = [
    { label: "Given this year", value: yearTotal },
    { label: "Givers", value: String(summary.givers) },
    { label: "Active pledges", value: String(summary.activePledges) },
    {
      label: "Duplicates to review",
      value: String(summary.pendingDuplicates),
      href: "/givings/duplicates",
      alert: summary.pendingDuplicates > 0,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h2 className="font-display text-3xl tracking-display text-ink">Givings</h2>
        <p className="font-sans text-sm text-muted-foreground">
          Tithes, offerings, seeds, pledges and partnerships — every gift posts
          to the immutable ledger and rolls up to one giver identity.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => {
          const body = (
            <Card className={s.alert ? "border-status-warning/40" : undefined}>
              <CardContent className="py-4">
                <div className="font-sans text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {s.label}
                </div>
                <div className="mt-1 font-display text-xl tracking-display text-ink">
                  {s.value}
                </div>
              </CardContent>
            </Card>
          );
          return s.href ? (
            <Link key={s.label} href={s.href}>
              {body}
            </Link>
          ) : (
            <div key={s.label}>{body}</div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="group">
            <Card className="h-full transition-colors group-hover:border-ink">
              <CardContent className="py-4">
                <div className="font-display text-sm tracking-display text-ink">
                  {n.label}
                </div>
                <div className="mt-0.5 font-sans text-[11px] text-muted-foreground">
                  {n.desc}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent giving</CardTitle>
          <Link href="/givings/record" className="font-sans text-xs text-muted-foreground hover:text-ink">
            Record →
          </Link>
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
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No giving recorded yet.
                  </TableCell>
                </TableRow>
              )}
              {recent.map((r: Record<string, string>) => (
                <TableRow key={r.id}>
                  <TableCell>{shortDate(r.transaction_date)}</TableCell>
                  <TableCell className="font-medium">{r.giver}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.type}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.entity}</TableCell>
                  <TableCell className="text-muted-foreground">{humanize(r.channel)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {money(r.amount, r.currency)}
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
