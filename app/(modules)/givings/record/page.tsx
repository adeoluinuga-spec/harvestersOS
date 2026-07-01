import Link from "next/link";
import {
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
import { getGivingTypes, getRecentGivings, searchGivers } from "@/lib/givings";
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";
import { RecordGivingForm } from "../_components/RecordGivingForm";

export const dynamic = "force-dynamic";

export default async function RecordGivingPage() {
  const ctx = await requireUser();

  const canWriteScope =
    ctx.isSuperAdmin || ctx.roles.some((r) => r.role !== "auditor");
  const scope = ctx.isSuperAdmin ? "all" : ctx.accessibleEntityIds;

  const [allEntities, givingTypes, givers, recent] = await Promise.all([
    getEntities(scope),
    getGivingTypes(),
    searchGivers(""),
    getRecentGivings(scope, 15),
  ]);

  // Entities the clerk may record for (exclude events? keep all accessible).
  const entities = allEntities.map((e) => ({
    id: e.id,
    name: e.name,
    functional_currency: e.functional_currency,
  }));

  const blocked = !canWriteScope || entities.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <Link href="/givings" className="font-sans text-xs text-muted-foreground hover:text-ink">
          ← Givings
        </Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Record Giving</h2>
        <p className="font-sans text-sm text-muted-foreground">
          Fast batch entry. Each gift is recorded and immediately posted to the
          ledger (double-entry). New givers are de-duplicated automatically.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>New gift</CardTitle>
            </CardHeader>
            <CardContent>
              {blocked ? (
                <p className="font-sans text-sm text-muted-foreground">
                  You don’t have permission to record giving for any entity. Ask
                  a super administrator to assign you a finance or data-entry role.
                </p>
              ) : (
                <RecordGivingForm
                  entities={entities}
                  givingTypes={givingTypes}
                  givers={givers}
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Recent entries</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Giver</TableHeaderCell>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {recent.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-muted-foreground">
                        Nothing recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {recent.map((r: Record<string, string>) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.giver}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {shortDate(r.transaction_date)} · {humanize(r.channel)}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.type}</TableCell>
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
      </div>
    </div>
  );
}
