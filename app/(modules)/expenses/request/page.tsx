import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getBudgetLineCommitments, getOpenApprovedBudgetLines } from "@/lib/budgeting";
import { getRequisitionEntities, getVendors } from "@/lib/requisitions";
import { BudgetAvailability, type BudgetLineView, type Commitment } from "@/components/expenses/BudgetAvailability";
import { ImportButton } from "@/components/ImportButton";
import { createRequestAction, createVendorAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function RequestPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const [entities, vendors, budgetLines] = await Promise.all([
    getRequisitionEntities(scope),
    getVendors(),
    getOpenApprovedBudgetLines(scope),
  ]);

  const shownLines: BudgetLineView[] = (budgetLines as Record<string, string>[]).slice(0, 8).map((b) => ({
    id: String(b.id),
    entity: String(b.entity_name),
    accountCode: String(b.account_code),
    accountName: String(b.account_name),
    approved: Number(b.approved_amount ?? 0),
    committed: Number(b.actual_amount ?? 0),
  }));
  const commitmentsRaw = await getBudgetLineCommitments(shownLines.map((l) => l.id));
  const commitments: Commitment[] = (commitmentsRaw as Record<string, string>[]).map((c) => ({
    lineId: String(c.budget_line_id),
    description: String(c.description),
    amount: Number(c.amount),
    currency: String(c.currency),
    status: String(c.status),
    created: String(c.created),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <Link href="/expenses" className="font-sans text-xs text-muted-foreground hover:text-ink">Back to requisitions</Link>
          <h2 className="font-display text-3xl tracking-display text-ink">New requisition</h2>
        </div>
        <ImportButton type="requisitions" label="Import requisitions" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <CardHeader><CardTitle>Request details</CardTitle></CardHeader>
          <CardContent>
            <form action={createRequestAction} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Entity" required>
                  <Select name="entity_id" required>
                    <option value="">Select entity</option>
                    {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </Select>
                </Field>
                <Field label="Currency" required>
                  <Input name="currency" defaultValue={entities[0]?.functional_currency ?? "NGN"} maxLength={3} required />
                </Field>
                <Field label="Branch" required>
                  <Select name="org_branch" defaultValue="congregational">
                    <option value="congregational">Congregational</option>
                    <option value="special_ministry">Special Ministry</option>
                    <option value="central_office">Central Office</option>
                  </Select>
                </Field>
                <Field label="Raising level" required>
                  <Select name="raised_by_level" defaultValue="campus">
                    <option value="campus">Campus</option>
                    <option value="sub_group">Sub Group</option>
                    <option value="group">Group</option>
                    <option value="ministry_directorate">Ministry Directorate</option>
                    <option value="head_of_expression">Head of Expression</option>
                    <option value="central_office">Central Office</option>
                  </Select>
                </Field>
                <Field label="Vendor">
                  <Select name="vendor_id">
                    <option value="">No vendor / internal payment</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}{v.bank_account_number_last4 ? ` · ${v.bank_account_number_last4}` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Budget line">
                  <Select name="budget_line_id">
                    <option value="">No budget line</option>
                    {budgetLines.map((b: Record<string, string>) => (
                      <option key={b.id} value={b.id}>
                        {b.fiscal_year} · {b.entity_name} · {b.account_code} · {b.account_name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Category" required>
                  <Input name="category" placeholder="Operations, welfare, capital expenditure" required />
                </Field>
                <Field label="Amount" required>
                  <Input name="amount" type="number" min="0.01" step="0.01" required />
                </Field>
                <Field label="Needed by">
                  <Input name="needed_by_date" type="date" />
                </Field>
              </div>
              <Field label="Description" required>
                <Textarea name="description" required placeholder="What is being requested and why?" />
              </Field>
              <Field label="Related-party disclosure">
                <Textarea
                  name="related_party_disclosure_note"
                  placeholder="Required when the selected vendor is marked as a related party."
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="flex items-center gap-2 rounded border border-paper-300 px-3 py-2 font-sans text-sm">
                  <input name="is_urgent" type="checkbox" className="h-4 w-4" />
                  Urgent
                </label>
                <label className="flex items-center gap-2 rounded border border-paper-300 px-3 py-2 font-sans text-sm">
                  <input name="wht_applicable" type="checkbox" className="h-4 w-4" />
                  WHT applies
                </label>
                <Field label="WHT rate %">
                  <Input name="wht_rate" type="number" min="0" max="100" step="0.01" defaultValue="0" />
                </Field>
              </div>
              <Button type="submit">Submit requisition</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Create vendor</CardTitle></CardHeader>
          <CardContent>
            <form action={createVendorAction} className="grid gap-4">
              <Field label="Vendor name" required><Input name="name" required /></Field>
              <Field label="Bank account number" required><Input name="bank_account_number" required /></Field>
              <Field label="TIN"><Input name="tax_id" /></Field>
              <label className="flex items-center gap-2 rounded border border-paper-300 px-3 py-2 font-sans text-sm">
                <input name="is_related_party" type="checkbox" className="h-4 w-4" />
                Related party
              </label>
              <Button type="submit" variant="secondary">Save vendor</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Budget availability</CardTitle></CardHeader>
          <CardContent>
            <BudgetAvailability lines={shownLines} commitments={commitments} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
