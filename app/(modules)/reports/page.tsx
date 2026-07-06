import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { money } from "@/lib/format";
import {
  getReportBuilderOptions,
  reportScope,
  runReport,
  type ReportRow,
  type ReportViewType,
} from "@/lib/reporting";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireUser();
  const scope = reportScope(ctx);
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const viewType = asString(searchParams?.view_type) as ReportViewType || "operational_ministry";
  const startDate = asString(searchParams?.start_date) || yearStart;
  const endDate = asString(searchParams?.end_date) || today;
  const entityId = asString(searchParams?.entity_id);
  const programType = asString(searchParams?.program_type) || "event";
  const programId = asString(searchParams?.program_id);

  const options = await getReportBuilderOptions(scope);
  const rows = await runReport({
    viewType,
    startDate,
    endDate,
    entityId,
    programType,
    programId,
    scope,
  });
  const exportBase = `/reports/export?view_type=${encodeURIComponent(viewType)}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}${entityId ? `&entity_id=${encodeURIComponent(entityId)}` : ""}${programType ? `&program_type=${encodeURIComponent(programType)}` : ""}${programId ? `&program_id=${encodeURIComponent(programId)}` : ""}`;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="font-display text-3xl tracking-display text-ink">Reports</h2>
          <p className="font-sans text-sm text-muted-foreground">
            Board-ready reporting across statutory, operational, and programmatic consolidation views.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/reports/trial-balance" className="font-sans text-sm text-muted-foreground hover:text-ink">Trial balance</Link>
          <Link href="/reports/weekly" className="font-sans text-sm text-muted-foreground hover:text-ink">Weekly income</Link>
          <Link href={`${exportBase}&format=excel`} className="font-sans text-sm text-muted-foreground hover:text-ink">Export Excel</Link>
          <Link href={`${exportBase}&format=pdf`} className="font-sans text-sm text-muted-foreground hover:text-ink">Print/PDF</Link>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Report builder</CardTitle></CardHeader>
        <CardContent>
          <form action="/reports" method="get" className="grid gap-4 lg:grid-cols-6">
            <Field label="View type">
              <Select name="view_type" defaultValue={viewType}>
                <option value="operational_ministry">Operational/ministry</option>
                <option value="legal_statutory">Legal/statutory</option>
                <option value="programmatic">Programmatic</option>
              </Select>
            </Field>
            <Field label="Statutory entity">
              <Select name="entity_id" defaultValue={entityId}>
                <option value="">Select entity</option>
                {options.statutoryEntities.map((e) => (
                  <option key={String(e.id)} value={String(e.id)}>
                    {e.name} ({e.statutory_jurisdiction ?? e.country})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Program type">
              <Select name="program_type" defaultValue={programType}>
                <option value="event">Event</option>
                <option value="restricted_fund">Restricted fund</option>
              </Select>
            </Field>
            <Field label="Program">
              <Select name="program_id" defaultValue={programId}>
                <option value="">Select program</option>
                <optgroup label="Events">
                  {options.events.map((e) => (
                    <option key={String(e.id)} value={String(e.id)}>{e.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Restricted funds">
                  {options.restrictedFunds.map((f) => (
                    <option key={String(f.id)} value={String(f.id)}>{f.name}</option>
                  ))}
                </optgroup>
              </Select>
            </Field>
            <Field label="Start"><Input name="start_date" type="date" defaultValue={startDate} /></Field>
            <Field label="End"><Input name="end_date" type="date" defaultValue={endDate} /></Field>
            <div className="lg:col-span-6">
              <Button type="submit">Generate report</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ReportSummary viewType={viewType} rows={rows} />
      <ReportTable rows={rows} />
    </div>
  );
}

function ReportSummary({ viewType, rows }: { viewType: string; rows: ReportRow[] }) {
  const revenue = sum(rows, ["total_income", "revenue_amount", "credit_amount"]);
  const cost = sum(rows, ["total_expense", "cost_amount"]);
  const net = sum(rows, ["net_position", "net_amount"]);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="View" value={humanize(viewType)} />
      <Metric label="Rows" value={String(rows.length)} />
      <Metric label="Revenue/income" value={money(revenue, "NGN")} />
      <Metric label="Net position" value={money(net || revenue - cost, "NGN")} />
    </div>
  );
}

function ReportTable({ rows }: { rows: ReportRow[] }) {
  const columns = Object.keys(rows[0] ?? {}).slice(0, 12);
  return (
    <Card>
      <CardHeader><CardTitle>Generated report</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHead>
            <TableRow>
              {columns.map((column) => <TableHeaderCell key={column}>{humanize(column)}</TableHeaderCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.slice(0, 100).map((row, index) => (
              <TableRow key={index}>
                {columns.map((column) => <TableCell key={column}>{formatCell(row[column])}</TableCell>)}
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={Math.max(columns.length, 1)} className="text-muted-foreground">No rows for this report selection.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent>
        <div className="font-sans text-xs uppercase text-muted-foreground">{label}</div>
        <div className="mt-2 font-display text-2xl tracking-display text-ink">{value}</div>
      </CardContent>
    </Card>
  );
}

function asString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function sum(rows: ReportRow[], keys: string[]) {
  return rows.reduce((total, row) => {
    for (const key of keys) {
      if (row[key] !== null && row[key] !== undefined) return total + Number(row[key] ?? 0);
    }
    return total;
  }, 0);
}

function formatCell(value: ReportRow[string]) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
