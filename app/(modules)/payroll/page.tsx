import Link from "next/link";
import {
  Badge,
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
import { getPayrollEntities, getPayrollRuns, getStaff } from "@/lib/payroll";
import {
  addComponentAction,
  approvePayrollRunAction,
  createPayrollRunAction,
  createStaffAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const [entities, staff, runs] = await Promise.all([
    getPayrollEntities(scope),
    getStaff(scope),
    getPayrollRuns(scope),
  ]);
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-3xl tracking-display text-ink">Payroll</h2>
          <p className="font-sans text-sm text-muted-foreground">
            Clergy and administrative staff compensation, calculated through configurable tax rules.
          </p>
        </div>
        <Link href="/payroll/honorariums" className="font-sans text-xs text-muted-foreground hover:text-ink">
          Honorariums
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Create staff</CardTitle></CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Add compensation component</CardTitle></CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create payroll run</CardTitle>
        </CardHeader>
        <CardContent>
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
            <Button type="submit" className="mt-6">Generate</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payroll runs</CardTitle></CardHeader>
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
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((r: Record<string, string | number>) => (
                <TableRow key={String(r.id)}>
                  <TableCell>{String(r.period_month).padStart(2, "0")}/{r.period_year}</TableCell>
                  <TableCell>{r.entity_name}</TableCell>
                  <TableCell><Badge variant="outline">{humanize(String(r.status))}</Badge></TableCell>
                  <TableCell className="text-right">{money(String(r.gross_amount))}</TableCell>
                  <TableCell className="text-right">{money(String(r.deductions))}</TableCell>
                  <TableCell className="text-right font-medium">{money(String(r.net_amount))}</TableCell>
                  <TableCell className="text-right">
                    {r.status === "draft" && (
                      <form action={approvePayrollRunAction}>
                        <input type="hidden" name="payroll_run_id" value={String(r.id)} />
                        <Button type="submit" size="sm">Approve</Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {runs.length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground">No payroll runs yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Staff register</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Tax state</TableHeaderCell>
                <TableHeaderCell className="text-right">Compensation</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {staff.map((s: Record<string, string>) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.full_name}</TableCell>
                  <TableCell><Badge variant="outline">{humanize(s.staff_type)}</Badge></TableCell>
                  <TableCell>{s.entity_name}</TableCell>
                  <TableCell className="text-muted-foreground">{s.state_of_taxation ?? "default"}</TableCell>
                  <TableCell className="text-right">{money(s.gross_compensation)}</TableCell>
                </TableRow>
              ))}
              {staff.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No staff records yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
