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
import { Pagination } from "@/components/Pagination";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";
import { getAccountLedger } from "@/lib/ledgerReports";

export const dynamic = "force-dynamic";

/** Level 2: every posted journal entry touching one account in the period. */
export default async function AccountLedgerPage({
  params,
  searchParams,
}: {
  params: { accountId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? ("all" as const) : ctx.accessibleEntityIds;
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const from = String(searchParams?.from ?? yearStart);
  const to = String(searchParams?.to ?? today);
  const page = Math.max(1, Number(searchParams?.page ?? 1) || 1);

  const { rows, total, account } = await getAccountLedger(params.accountId, scope, from, to, page);
  if (!account) {
    return <div className="mx-auto max-w-3xl font-sans text-sm text-muted-foreground">Account not found.</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <Link href={`/reports/trial-balance?from=${from}&to=${to}`} className="font-sans text-xs text-muted-foreground hover:text-ink">
          ← Trial balance
        </Link>
        <h2 className="font-display text-3xl tracking-display text-ink">
          <span className="font-mono text-2xl">{account.code}</span> {account.name}
        </h2>
        <p className="font-sans text-sm text-muted-foreground">
          {from} → {to} · {total.toLocaleString()} entries · click an entry for its lines and source documents
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account ledger</CardTitle>
          <CardDescription>Presentation currency (NGN)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Entry</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Source</TableHeaderCell>
                <TableHeaderCell className="text-right">Debit</TableHeaderCell>
                <TableHeaderCell className="text-right">Credit</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.journal_entry_id}>
                  <TableCell>
                    <Link
                      href={`/reports/entry/${r.journal_entry_id}`}
                      className="font-mono text-xs font-semibold text-ink underline-offset-2 hover:underline"
                    >
                      {r.entry_number ?? r.journal_entry_id.slice(0, 8)}
                    </Link>
                    <div className="font-sans text-xs text-muted-foreground">
                      {shortDate(r.transaction_date)} · {r.description ?? "—"}
                    </div>
                  </TableCell>
                  <TableCell>{r.entity_name}</TableCell>
                  <TableCell><Badge variant="outline">{humanize(r.source_module)}</Badge></TableCell>
                  <TableCell className="text-right">{Number(r.debit_ngn) ? money(r.debit_ngn) : "—"}</TableCell>
                  <TableCell className="text-right">{Number(r.credit_ngn) ? money(r.credit_ngn) : "—"}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-muted-foreground">No activity in this period.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Pagination
        page={page}
        pageSize={50}
        total={total}
        basePath={`/reports/ledger/${params.accountId}`}
        params={{ from, to }}
      />
    </div>
  );
}
