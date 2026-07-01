import Link from "next/link";
import {
  Card,
  CardContent,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getGivingStatement, searchGivers } from "@/lib/givings";
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";
import { PrintButton } from "../_components/PrintButton";

export const dynamic = "force-dynamic";

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: { giver?: string; year?: string };
}) {
  await requireUser();
  const giverId = searchParams.giver;
  const year = Number(searchParams.year) || new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  if (!giverId) {
    const givers = await searchGivers("");
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-1">
          <Link href="/givings" className="font-sans text-xs text-muted-foreground hover:text-ink">
            ← Givings
          </Link>
          <h2 className="font-display text-3xl tracking-display text-ink">
            Giving Statements
          </h2>
          <p className="font-sans text-sm text-muted-foreground">
            Generate a per-giver, per-year statement for tax purposes.
          </p>
        </div>
        <Card>
          <CardContent>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <label className="flex-1">
                <span className="mb-1 block font-sans text-xs font-semibold uppercase tracking-[0.08em] text-ink-600">
                  Giver
                </span>
                <Select name="giver" defaultValue="" required>
                  <option value="" disabled>
                    — choose a giver —
                  </option>
                  {givers.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.full_name}
                      {g.phone ? ` · ${g.phone}` : ""}
                    </option>
                  ))}
                </Select>
              </label>
              <label>
                <span className="mb-1 block font-sans text-xs font-semibold uppercase tracking-[0.08em] text-ink-600">
                  Year
                </span>
                <Select name="year" defaultValue={String(year)}>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </Select>
              </label>
              <button
                type="submit"
                className="h-10 rounded bg-ink px-4 font-sans text-sm font-medium text-paper hover:bg-ink-800"
              >
                Generate
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  const st = await getGivingStatement(giverId, year);
  if (!st.giver) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="font-sans text-sm text-muted-foreground">Giver not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/givings/statements" className="font-sans text-xs text-muted-foreground hover:text-ink">
          ← Statements
        </Link>
        <PrintButton />
      </div>

      <div className="rounded-md border border-paper-200 bg-surface p-8 shadow-card print:border-0 print:shadow-none">
        <div className="mb-6 flex items-start justify-between border-b border-paper-200 pb-4">
          <div>
            <div className="font-display text-lg tracking-display text-ink">
              HARVESTERS INTERNATIONAL CHRISTIAN CENTRE
            </div>
            <div className="font-sans text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Annual Giving Statement · {st.year}
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="font-sans text-xs uppercase tracking-[0.12em] text-muted-foreground">
            Prepared for
          </div>
          <div className="font-display text-xl tracking-display text-ink">
            {st.giver.full_name}
          </div>
          <div className="font-sans text-sm text-muted-foreground">
            {st.giver.email ?? ""} {st.giver.phone ? `· ${st.giver.phone}` : ""}
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <div className="mb-2 font-sans text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Summary by type
            </div>
            {st.byType.map((t: Record<string, string>, i: number) => (
              <div key={i} className="flex justify-between border-b border-paper-100 py-1 font-sans text-sm">
                <span>{t.name}</span>
                <span className="font-medium">{money(t.total, t.currency)}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-2 font-sans text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Summary by entity
            </div>
            {st.byEntity.map((t: Record<string, string>, i: number) => (
              <div key={i} className="flex justify-between border-b border-paper-100 py-1 font-sans text-sm">
                <span>{t.name}</span>
                <span className="font-medium">{money(t.total, t.currency)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between rounded bg-paper-50 px-4 py-3">
          <span className="font-display text-sm tracking-display text-ink">Total for {st.year}</span>
          <span className="font-display text-lg tracking-display text-ink">
            {st.grand.length
              ? st.grand.map((g: Record<string, string>) => money(g.total, g.currency)).join(" · ")
              : money(0)}
          </span>
        </div>

        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Date</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Entity</TableHeaderCell>
              <TableHeaderCell>Channel</TableHeaderCell>
              <TableHeaderCell className="text-right">Amount</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {st.transactions.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No giving recorded in {st.year}.
                </TableCell>
              </TableRow>
            )}
            {st.transactions.map((t: Record<string, string>, i: number) => (
              <TableRow key={i}>
                <TableCell>{shortDate(t.transaction_date)}</TableCell>
                <TableCell>{t.type_name}</TableCell>
                <TableCell className="text-muted-foreground">{t.entity_name}</TableCell>
                <TableCell className="text-muted-foreground">{humanize(t.channel)}</TableCell>
                <TableCell className="text-right font-medium">
                  {money(t.amount, t.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <p className="mt-6 font-sans text-[11px] leading-relaxed text-muted-foreground">
          This statement reflects giving recorded in the Harvesters Finance OS
          ledger for the stated period. Retain for your records.
        </p>
      </div>
    </div>
  );
}
