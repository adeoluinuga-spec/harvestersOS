import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Button,
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
import { getBatch, getBatchRows } from "@/lib/imports/core";
import { humanize } from "@/lib/enums";
import { commitImport } from "../actions";

export const dynamic = "force-dynamic";

export default async function ImportBatchPage({ params }: { params: { id: string } }) {
  await requireUser();
  const batch = (await getBatch(params.id)) as Record<string, string | number> | null;
  if (!batch) notFound();

  const committable = batch.status === "validated" && Number(batch.valid_rows) > 0;
  const errorRows = (await getBatchRows(params.id, "invalid")) as Record<string, unknown>[];
  const failedRows =
    batch.status === "partially_committed" || batch.status === "failed"
      ? ((await getBatchRows(params.id, "failed")) as Record<string, unknown>[])
      : [];

  const stat = (label: string, value: number | string) => (
    <div className="rounded-md border border-paper-200 bg-surface px-4 py-3">
      <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-display text-xl tracking-display text-ink">{value}</div>
    </div>
  );

  const rowErrors = (r: Record<string, unknown>) => {
    const errs = r.errors as { field?: string; message: string }[] | null;
    return errs?.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).join("; ") ?? "";
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <Link href="/imports" className="font-sans text-xs text-muted-foreground hover:text-ink">
          ← Imports
        </Link>
        <div className="flex items-center gap-3">
          <h2 className="font-display text-3xl tracking-display text-ink">
            {humanize(String(batch.import_type))}
          </h2>
          <Badge variant="outline">{humanize(String(batch.status))}</Badge>
        </div>
        <p className="font-sans text-sm text-muted-foreground">{batch.file_name}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stat("Total rows", Number(batch.total_rows))}
        {stat("Valid", Number(batch.valid_rows))}
        {stat("Errors", Number(batch.error_rows))}
        {stat("Committed", Number(batch.committed_rows))}
      </div>

      {committable && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div className="font-sans text-sm text-ink-700">
              {Number(batch.valid_rows)} valid row(s) ready to commit.
              {Number(batch.error_rows) > 0 && " Invalid rows below will be skipped."}
            </div>
            <form action={commitImport}>
              <input type="hidden" name="batch_id" value={String(batch.id)} />
              <Button type="submit">Commit {Number(batch.valid_rows)} rows</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {batch.status === "committed" && (
        <Card>
          <CardContent className="py-4 font-sans text-sm text-status-success">
            ✓ Committed {Number(batch.committed_rows)} rows successfully.
          </CardContent>
        </Card>
      )}

      {(errorRows.length > 0 || failedRows.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Rows needing attention</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Row</TableHeaderCell>
                  <TableHeaderCell>Problem</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[...errorRows, ...failedRows].map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{String(r.row_number)}</TableCell>
                    <TableCell className="text-status-danger">{rowErrors(r)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
