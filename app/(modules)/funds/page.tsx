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
  Textarea,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";
import {
  getAllowedUses,
  getExpenseAccounts,
  getFundEntities,
  getInterFundLoans,
  getRestrictedFundActivity,
  getRestrictedFundBalances,
} from "@/lib/funds";
import {
  addAllowedUseAction,
  createInterFundLoanAction,
  createRestrictedFundAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function FundsPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const [entities, accounts, funds, allowedUses, loans, activity] = await Promise.all([
    getFundEntities(scope),
    getExpenseAccounts(),
    getRestrictedFundBalances(scope),
    getAllowedUses(scope),
    getInterFundLoans(scope),
    getRestrictedFundActivity(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-3xl tracking-display text-ink">Funds</h2>
          <p className="font-sans text-sm text-muted-foreground">
            Restricted fund balances, allowed uses, and formal inter-fund loans.
          </p>
        </div>
        <Link href="/funds/investments" className="font-sans text-xs text-muted-foreground hover:text-ink">
          Investments
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Create restricted fund</CardTitle></CardHeader>
          <CardContent>
            <form action={createRestrictedFundAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Entity" required className="sm:col-span-2">
                <Select name="entity_id" required>
                  <option value="">Select entity</option>
                  {entities.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </Select>
              </Field>
              <Field label="Fund name" required className="sm:col-span-2"><Input name="name" required /></Field>
              <Field label="Classification">
                <Select name="fund_classification" defaultValue="temporarily_restricted">
                  <option value="temporarily_restricted">Temporarily restricted</option>
                  <option value="permanently_restricted">Permanently restricted</option>
                  <option value="board_designated">Board designated</option>
                </Select>
              </Field>
              <Field label="Target amount"><Input name="target_amount" type="number" min="0" step="0.01" defaultValue="0" /></Field>
              <Field label="Purpose" className="sm:col-span-2"><Textarea name="purpose_description" /></Field>
              <Button type="submit">Create fund</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Whitelist restricted use</CardTitle></CardHeader>
          <CardContent>
            <form action={addAllowedUseAction} className="grid gap-4">
              <Field label="Restricted fund" required>
                <Select name="restricted_fund_id" required>
                  <option value="">Select fund</option>
                  {funds.map((f: Record<string, string>) => <option key={f.id} value={f.id}>{f.entity_name} · {f.name}</option>)}
                </Select>
              </Field>
              <Field label="Allowed expense account" required>
                <Select name="account_id" required>
                  <option value="">Select account</option>
                  {accounts.map((a: Record<string, string>) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </Select>
              </Field>
              <Button type="submit">Add allowed use</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Restricted funds dashboard</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Fund</TableHeaderCell>
                <TableHeaderCell>Classification</TableHeaderCell>
                <TableHeaderCell className="text-right">Balance</TableHeaderCell>
                <TableHeaderCell className="text-right">Target</TableHeaderCell>
                <TableHeaderCell className="text-right">% funded</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {funds.map((f: Record<string, string>) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <div className="font-medium">{f.name}</div>
                    <div className="font-sans text-xs text-muted-foreground">{f.entity_name}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{humanize(f.fund_classification)}</Badge></TableCell>
                  <TableCell className="text-right">{money(f.current_balance)}</TableCell>
                  <TableCell className="text-right">{money(f.target_amount)}</TableCell>
                  <TableCell className="text-right">{f.percent_funded ? `${f.percent_funded}%` : "n/a"}</TableCell>
                </TableRow>
              ))}
              {funds.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No restricted funds yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Allowed uses</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {allowedUses.map((u: Record<string, string>) => (
              <div key={`${u.restricted_fund_id}-${u.account_id}`} className="border-b border-paper-200 pb-3 last:border-0 last:pb-0">
                <div className="font-sans text-sm font-medium">{u.fund_name}</div>
                <div className="font-sans text-xs text-muted-foreground">{u.entity_name} · {u.account_code} · {u.account_name}</div>
              </div>
            ))}
            {allowedUses.length === 0 && <p className="font-sans text-sm text-muted-foreground">No restricted fund allowed uses configured.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent restricted activity</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {activity.slice(0, 8).map((a: Record<string, string>) => (
              <div key={`${a.restricted_fund_id}-${a.journal_entry_id}-${a.account_code}`} className="border-b border-paper-200 pb-3 last:border-0 last:pb-0">
                <div className="font-sans text-sm font-medium">{a.description ?? "Ledger activity"}</div>
                <div className="font-sans text-xs text-muted-foreground">
                  {shortDate(a.transaction_date)} · {a.account_code} · Dr {money(a.debit_amount, a.currency)} · Cr {money(a.credit_amount, a.currency)}
                </div>
              </div>
            ))}
            {activity.length === 0 && <p className="font-sans text-sm text-muted-foreground">No posted restricted-fund activity yet.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Formal inter-fund / inter-entity loans</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <form action={createInterFundLoanAction} className="grid gap-4 lg:grid-cols-4">
            <Field label="Lending entity" required>
              <Select name="lending_entity_id" required>
                <option value="">Select lender</option>
                {entities.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
            <Field label="Lending fund">
              <Select name="lending_fund">
                <option value="">Unrestricted</option>
                {funds.map((f: Record<string, string>) => <option key={f.id} value={f.id}>{f.entity_name} · {f.name}</option>)}
              </Select>
            </Field>
            <Field label="Borrowing entity" required>
              <Select name="borrowing_entity_id" required>
                <option value="">Select borrower</option>
                {entities.map((e: Record<string, string>) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
            <Field label="Principal" required><Input name="principal_amount" type="number" min="0.01" step="0.01" required /></Field>
            <Field label="Currency" required><Input name="currency" defaultValue="NGN" maxLength={3} /></Field>
            <Field label="Date issued" required><Input name="date_issued" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="Schedule JSON"><Input name="repayment_schedule" defaultValue="[]" /></Field>
            <Field label="Borrowing purpose" className="lg:col-span-4" required><Textarea name="borrowing_purpose" required /></Field>
            <Button type="submit">Create loan</Button>
          </form>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Loan</TableHeaderCell>
                <TableHeaderCell>Purpose</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Principal</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loans.map((l: Record<string, string>) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="font-medium">{l.lending_entity_name} → {l.borrowing_entity_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">{l.lending_fund_name ?? "Unrestricted"} · {shortDate(l.date_issued)}</div>
                  </TableCell>
                  <TableCell>{l.borrowing_purpose}</TableCell>
                  <TableCell><Badge variant="outline">{humanize(l.status)}</Badge></TableCell>
                  <TableCell className="text-right">{money(l.principal_amount, l.currency)}</TableCell>
                </TableRow>
              ))}
              {loans.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">No formal fund loans yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
