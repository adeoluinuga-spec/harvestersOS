import Link from "next/link";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
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
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";
import { getJournalEntryDetail } from "@/lib/ledgerReports";

export const dynamic = "force-dynamic";

/**
 * Level 3: one journal entry — header, every debit/credit line, who created
 * and approved it, its reversal linkage, the source record it came from, and
 * the documents that support it. The end of every drill-down.
 */
export default async function JournalEntryPage({ params }: { params: { id: string } }) {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? ("all" as const) : ctx.accessibleEntityIds;
  const je = await getJournalEntryDetail(params.id, scope);
  if (!je) {
    return <div className="mx-auto max-w-3xl font-sans text-sm text-muted-foreground">Entry not found or outside your scope.</div>;
  }

  const totals = je.lines.reduce(
    (acc, l) => ({
      debit: acc.debit + Number(l.debit_amount) * Number(l.fx_rate),
      credit: acc.credit + Number(l.credit_amount) * Number(l.fx_rate),
    }),
    { debit: 0, credit: 0 }
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <Link href="/reports/trial-balance" className="font-sans text-xs text-muted-foreground hover:text-ink">
          ← Trial balance
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-3xl tracking-display text-ink">
            {je.entry_number ?? `Entry ${je.id.slice(0, 8)}`}
          </h2>
          <Badge variant={je.status === "posted" ? "outline" : "solid"}>{humanize(je.status)}</Badge>
          <Badge variant="muted">{humanize(je.source_module)}</Badge>
        </div>
        <p className="font-sans text-sm text-muted-foreground">
          {je.entity_name} · {shortDate(je.transaction_date)} · {je.description ?? "no description"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          <CardDescription>Debits must equal credits in presentation currency — always</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Account</TableHeaderCell>
                <TableHeaderCell>Entity / fund</TableHeaderCell>
                <TableHeaderCell className="text-right">Debit</TableHeaderCell>
                <TableHeaderCell className="text-right">Credit</TableHeaderCell>
                <TableHeaderCell className="text-right">FX → NGN</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {je.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <span className="font-mono text-xs font-semibold">{l.account_code}</span>{" "}
                    <span className="font-medium">{l.account_name}</span>
                  </TableCell>
                  <TableCell>
                    <div className="font-sans text-sm">{l.entity_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">{humanize(l.fund_classification)}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(l.debit_amount) ? money(l.debit_amount, l.currency) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(l.credit_amount) ? money(l.credit_amount, l.currency) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-sans text-xs text-muted-foreground">
                    {Number(l.fx_rate) === 1 ? "1.0" : Number(l.fx_rate).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-bold" colSpan={2}>Totals (NGN)</TableCell>
                <TableCell className="text-right font-bold">{money(String(totals.debit))}</TableCell>
                <TableCell className="text-right font-bold">{money(String(totals.credit))}</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Provenance</CardTitle></CardHeader>
          <CardContent className="space-y-2 font-sans text-sm">
            <Row label="Created by" value={je.created_by_email ?? "system"} />
            <Row label="Approved by" value={je.approved_by_email ?? "system"} />
            <Row label="Posted at" value={je.posted_at ? shortDate(je.posted_at) : "—"} />
            {je.reversal_of_entry_id && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Reverses</span>
                <Link href={`/reports/entry/${je.reversal_of_entry_id}`} className="font-mono text-xs underline underline-offset-2">
                  {je.reversal_of_entry_id.slice(0, 8)}…
                </Link>
              </div>
            )}
            {je.reversed_by_entry_id && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Reversed by</span>
                <Link href={`/reports/entry/${je.reversed_by_entry_id}`} className="font-mono text-xs underline underline-offset-2">
                  {je.reversed_by_entry_id.slice(0, 8)}…
                </Link>
              </div>
            )}
            {je.source && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Source</span>
                <Link href={je.source.href} className="underline underline-offset-2">{je.source.label}</Link>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Supporting documents</CardTitle>
            <CardDescription>Invoices/quotes attached to this entry or its requisition</CardDescription>
          </CardHeader>
          <CardContent>
            {je.documents.length === 0 ? (
              <p className="font-sans text-sm text-muted-foreground">No documents attached.</p>
            ) : (
              <ul className="space-y-1">
                {je.documents.map((d) => (
                  <li key={d.id}>
                    <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer"
                       className="font-sans text-sm text-cobalt underline underline-offset-2">
                      📎 {d.file_name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
