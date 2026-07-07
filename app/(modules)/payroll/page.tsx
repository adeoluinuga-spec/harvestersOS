import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
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
import { Pagination } from "@/components/Pagination";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { compactMoney, money } from "@/lib/format";
import {
  getPayrollApprovalInbox,
  getPayrollCadreTree,
  getPayrollEntities,
  getPayrollRuns,
  getPayrollSettings,
  getStaff,
  type CadreNode,
} from "@/lib/payroll";
import {
  addComponentAction,
  approvePayrollRunAction,
  createPayrollRunAction,
  createStaffAction,
  rejectPayrollRunAction,
} from "./actions";

export const dynamic = "force-dynamic";

function nextCycles(day1: number, day2: number): { date: Date; days: number }[] {
  const today = new Date();
  const mk = (y: number, m: number, d: number) => new Date(y, m, d);
  const candidates = [
    mk(today.getFullYear(), today.getMonth(), day1),
    mk(today.getFullYear(), today.getMonth(), day2),
    mk(today.getFullYear(), today.getMonth() + 1, day1),
    mk(today.getFullYear(), today.getMonth() + 1, day2),
  ];
  return candidates
    .filter((d) => d.getTime() >= new Date(today.toDateString()).getTime())
    .slice(0, 2)
    .map((date) => ({
      date,
      days: Math.round((date.getTime() - new Date(today.toDateString()).getTime()) / 86400000),
    }));
}

const CADRE_LABEL: Record<string, string> = {
  group: "Group",
  sub_group: "Sub-group",
  campus: "Campus",
  ministry_directorate: "Ministry",
  ministry_expression: "Ministry expression",
};

function CadreBranch({ node, depth }: { node: CadreNode; depth: number }) {
  const hasChildren = node.children.length > 0;
  const row = (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <span className="font-sans text-sm font-medium text-ink">{node.name}</span>
        <span className="ml-2 font-sans text-[11px] text-muted-foreground">
          {CADRE_LABEL[node.type] ?? humanize(node.type)} · {node.staff_count} staff
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {node.latest_run_status && (
          <Badge variant={node.latest_run_status === "pending_approval" ? "solid" : "outline"}>
            {node.latest_period}: {humanize(node.latest_run_status)}
          </Badge>
        )}
        <span className="font-sans text-sm font-semibold text-ink" data-numeric>
          {compactMoney(Number(node.monthly_net))}
        </span>
      </div>
    </div>
  );

  if (!hasChildren) {
    return (
      <Link
        href={`/payroll/entity/${node.id}`}
        className="flex items-center gap-2 rounded-md px-3 transition-colors hover:bg-paper-50"
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
      >
        <span className="w-4" />
        {row}
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" />
      </Link>
    );
  }

  return (
    <details className="group" open={depth === 0 && node.children.length <= 6}>
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 transition-colors hover:bg-paper-50 [&::-webkit-details-marker]:hidden"
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
      >
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-300 transition-transform group-open:rotate-90" />
        {row}
        <Link
          href={`/payroll/entity/${node.id}`}
          className="shrink-0 font-sans text-[11px] font-semibold text-cobalt hover:underline"
        >
          Open
        </Link>
      </summary>
      <div>
        {node.children.map((c) => (
          <CadreBranch key={c.id} node={c} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

export default async function PayrollPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? ("all" as const) : ctx.accessibleEntityIds;
  const roles = Array.from(new Set(ctx.roles.map((r) => r.role)));
  const page = Math.max(1, Number(searchParams?.page ?? 1) || 1);
  const error = typeof searchParams?.error === "string" ? searchParams.error : null;

  const [entities, staff, runsPage, tree, inbox, settings] = await Promise.all([
    getPayrollEntities(scope),
    getStaff(scope),
    getPayrollRuns(scope, page, 20),
    getPayrollCadreTree(scope),
    getPayrollApprovalInbox(scope, roles),
    getPayrollSettings(),
  ]);
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const cycles = nextCycles(Number(settings?.cycle_day_1 ?? 13), Number(settings?.cycle_day_2 ?? 26));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-3xl tracking-display text-ink">Payroll</h2>
          <p className="font-sans text-sm text-muted-foreground">
            Federated by cadre: HR prepares, the pastor/head approves, finance uploads,
            account signatories confirm. Everyone is paid in two half-salary cycles.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/payroll/payments" className="font-sans text-sm font-semibold text-cobalt hover:underline">
            Payments board →
          </Link>
          <Link href="/payroll/honorariums" className="font-sans text-sm text-muted-foreground hover:text-ink">
            Honorariums
          </Link>
        </div>
      </div>

      {error && (
        <p className="rounded border border-status-danger/30 bg-status-danger-bg px-3 py-2 font-sans text-sm text-status-danger">
          {error === "permission" ? "You do not have permission for that action." : decodeURIComponent(error)}
        </p>
      )}

      {/* Cycle banner */}
      <div className="flex flex-wrap gap-3">
        {cycles.map((c, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-paper-200/60 bg-surface px-4 py-3 shadow-card">
            <div
              className={
                "flex h-9 w-9 items-center justify-center rounded-md font-sans text-sm font-bold " +
                (c.days <= Number(settings?.escalation_days ?? 2)
                  ? "bg-status-danger-bg text-status-danger"
                  : c.days <= Number(settings?.lead_days ?? 5)
                    ? "bg-status-warning-bg text-status-warning"
                    : "bg-cobalt-light text-cobalt")
              }
              data-numeric
            >
              {c.date.getDate()}
            </div>
            <div>
              <div className="font-sans text-sm font-semibold text-ink">
                {c.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} payment cycle
              </div>
              <div className="font-sans text-xs text-muted-foreground">
                {c.days === 0 ? "Today" : `In ${c.days} day${c.days === 1 ? "" : "s"}`} · half-salary run
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Approvals waiting on the signed-in pastor/head */}
      {inbox.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Awaiting your approval</CardTitle>
            <CardDescription>Submitted payrolls routed to your role</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-paper-100">
              {inbox.map((r: Record<string, unknown>) => (
                <li key={String(r.id)} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                  <div>
                    <Link href={`/payroll/runs/${r.id}`} className="font-sans text-sm font-semibold text-ink hover:underline">
                      {String(r.entity_name)} — {String(r.period_month).padStart(2, "0")}/{String(r.period_year)}
                    </Link>
                    <div className="font-sans text-xs text-muted-foreground">
                      {String(r.headcount)} staff · net {money(String(r.net))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <form action={approvePayrollRunAction}>
                      <input type="hidden" name="payroll_run_id" value={String(r.id)} />
                      <input type="hidden" name="entity_id" value={String(r.entity_id)} />
                      <Button type="submit" size="sm">Approve</Button>
                    </form>
                    <form action={rejectPayrollRunAction} className="flex items-center gap-2">
                      <input type="hidden" name="payroll_run_id" value={String(r.id)} />
                      <input type="hidden" name="entity_id" value={String(r.entity_id)} />
                      <Input name="reason" placeholder="Reason" className="h-8 w-36 text-xs" />
                      <Button type="submit" size="sm" variant="danger">Reject</Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Cadre drill-down */}
      <Card>
        <CardHeader>
          <CardTitle>Payroll by cadre</CardTitle>
          <CardDescription>
            Groups, central office and ministries — expand to campuses; open any entity
            for its payroll history and analysis
          </CardDescription>
        </CardHeader>
        <CardContent className="px-3 py-2">
          {tree.length === 0 ? (
            <p className="px-3 py-4 font-sans text-sm text-muted-foreground">No entities in your scope.</p>
          ) : (
            tree.map((n) => <CadreBranch key={n.id} node={n} depth={0} />)
          )}
        </CardContent>
      </Card>

      {/* Runs (paginated) */}
      <Card>
        <CardHeader>
          <CardTitle>Payroll runs</CardTitle>
          <CardDescription>{runsPage.total.toLocaleString()} runs in your scope</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Period</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Gross</TableHeaderCell>
                <TableHeaderCell className="text-right">Deductions</TableHeaderCell>
                <TableHeaderCell className="text-right">Net</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runsPage.rows.map((r: Record<string, string | number>) => (
                <TableRow key={String(r.id)}>
                  <TableCell>
                    <Link href={`/payroll/runs/${r.id}`} className="font-medium text-ink hover:underline">
                      {String(r.period_month).padStart(2, "0")}/{r.period_year}
                    </Link>
                  </TableCell>
                  <TableCell>{r.entity_name}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "pending_approval" ? "solid" : "outline"}>
                      {humanize(String(r.status))}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{money(String(r.gross_amount))}</TableCell>
                  <TableCell className="text-right">{money(String(r.deductions))}</TableCell>
                  <TableCell className="text-right font-medium">{money(String(r.net_amount))}</TableCell>
                </TableRow>
              ))}
              {runsPage.rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-muted-foreground">No payroll runs yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination page={page} pageSize={20} total={runsPage.total} basePath="/payroll" params={{}} />
        </CardContent>
      </Card>

      {/* Setup & preparation (progressive disclosure) */}
      <details className="rounded-lg border border-paper-200/60 bg-surface shadow-card">
        <summary className="cursor-pointer list-none px-6 py-4 font-display text-[15px] font-semibold tracking-display text-ink [&::-webkit-details-marker]:hidden">
          Setup — staff, compensation & run generation
        </summary>
        <div className="space-y-6 border-t border-paper-100 px-6 py-5">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h4 className="mb-3 font-sans text-sm font-semibold text-ink">Create staff</h4>
              <form action={createStaffAction} className="grid gap-4 sm:grid-cols-2">
                <Field label="Entity" required className="sm:col-span-2">
                  <Select name="entity_id" required>
                    <option value="">Select entity</option>
                    {entities.map((e: Record<string, string>) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Full name" required className="sm:col-span-2"><Input name="full_name" required /></Field>
                <Field label="Staff type" required>
                  <Select name="staff_type" defaultValue="administrative">
                    <option value="minister_clergy">Minister / clergy</option>
                    <option value="administrative">Administrative</option>
                  </Select>
                </Field>
                <Field label="Status" required>
                  <Select name="employment_status" defaultValue="employed">
                    <option value="employed">Employed</option>
                    <option value="volunteer_honorarium">Volunteer / honorarium</option>
                  </Select>
                </Field>
                <Field label="Tax state"><Input name="state_of_taxation" placeholder="default, Lagos..." /></Field>
                <Field label="PFA provider"><Input name="pfa_provider" /></Field>
                <Field label="Pension ID" className="sm:col-span-2"><Input name="pension_id" /></Field>
                <Button type="submit">Save staff</Button>
              </form>
            </div>
            <div>
              <h4 className="mb-3 font-sans text-sm font-semibold text-ink">Add compensation component</h4>
              <form action={addComponentAction} className="grid gap-4 sm:grid-cols-2">
                <Field label="Staff" required className="sm:col-span-2">
                  <Select name="staff_id" required>
                    <option value="">Select staff</option>
                    {staff.map((s: Record<string, string>) => (
                      <option key={s.id} value={s.id}>{s.full_name} · {humanize(s.staff_type)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Component" required>
                  <Select name="component_type" defaultValue="base_salary">
                    <option value="base_salary">Base salary</option>
                    <option value="housing_allowance">Housing allowance</option>
                    <option value="transport_allowance">Transport allowance</option>
                    <option value="other_allowance">Other allowance</option>
                  </Select>
                </Field>
                <Field label="Currency" required><Input name="currency" defaultValue="NGN" maxLength={3} /></Field>
                <Field label="Amount" required><Input name="amount" type="number" min="0" step="0.01" required /></Field>
                <label className="mt-6 flex h-10 items-center gap-2 rounded border border-paper-300 px-3 font-sans text-sm">
                  <input name="is_taxable" type="checkbox" defaultChecked className="h-4 w-4" />
                  Taxable
                </label>
                <Button type="submit">Add component</Button>
              </form>
            </div>
          </div>
          <div>
            <h4 className="mb-3 font-sans text-sm font-semibold text-ink">Generate a payroll run</h4>
            <form action={createPayrollRunAction} className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <Field label="Entity" required>
                <Select name="entity_id" required>
                  <option value="">Select entity</option>
                  {entities.map((e: Record<string, string>) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Month" required><Input name="period_month" type="number" min="1" max="12" defaultValue={month} /></Field>
              <Field label="Year" required><Input name="period_year" type="number" min="2000" defaultValue={year} /></Field>
              <Button type="submit" className="mt-6">Generate draft</Button>
            </form>
            <p className="mt-2 font-sans text-xs text-muted-foreground">
              Generates a draft from compensation + this period&apos;s adjustments. Open the run to
              add one-off earnings/deductions, attach documents and submit for approval.
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
