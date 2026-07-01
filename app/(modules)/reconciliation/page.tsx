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
  getBankAccountsForReconciliation,
  getCandidateJournalLines,
  getCashCountSessions,
  getCashVarianceReport,
  getReconciliationDashboard,
  getUnmatchedBankTransactions,
  getUnreconciledItems,
  getUsersForCashCount,
} from "@/lib/reconciliation";
import {
  autoMatchAction,
  createCashCountAction,
  createCashDepositAction,
  ingestBankFeedAction,
  manualMatchAction,
} from "./actions";

export const dynamic = "force-dynamic";

type Row = Record<string, string | number | boolean | null>;

export default async function ReconciliationPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const [dashboard, unreconciled, bankAccounts, unmatched, candidates, users, sessions, variances] =
    await Promise.all([
      getReconciliationDashboard(scope),
      getUnreconciledItems(scope),
      getBankAccountsForReconciliation(scope),
      getUnmatchedBankTransactions(scope),
      getCandidateJournalLines(scope),
      getUsersForCashCount(),
      getCashCountSessions(scope),
      getCashVarianceReport(scope),
    ]);
  const today = new Date().toISOString().slice(0, 10);
  const staleCount = unreconciled.filter((r: Row) => r.is_stale).length;
  const reviewCount = dashboard.reduce((sum: number, r: Row) => sum + Number(r.manual_review_queue ?? 0), 0);
  const varianceCount = variances.filter((r: Row) => r.variance_status === "review_required").length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-1">
        <h2 className="font-display text-3xl tracking-display text-ink">Reconciliation</h2>
        <p className="font-sans text-sm text-muted-foreground">
          Bank-feed matching, stale unreconciled controls, and physical cash custody.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent><div className="font-sans text-xs uppercase text-muted-foreground">Manual review queue</div><div className="mt-2 font-display text-3xl">{reviewCount}</div></CardContent></Card>
        <Card><CardContent><div className="font-sans text-xs uppercase text-muted-foreground">Stale unreconciled items</div><div className="mt-2 font-display text-3xl">{staleCount}</div></CardContent></Card>
        <Card><CardContent><div className="font-sans text-xs uppercase text-muted-foreground">Cash variances</div><div className="mt-2 font-display text-3xl">{varianceCount}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Bank reconciliation dashboard</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Bank account</TableHeaderCell>
                <TableHeaderCell className="text-right">Unmatched</TableHeaderCell>
                <TableHeaderCell className="text-right">Review queue</TableHeaderCell>
                <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                <TableHeaderCell>Auto-match</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {dashboard.map((r: Row) => (
                <TableRow key={String(r.bank_account_id)}>
                  <TableCell>
                    <div className="font-medium">{r.entity_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">{r.bank_name} {r.account_number_last4 ? `*${r.account_number_last4}` : ""}</div>
                  </TableCell>
                  <TableCell className="text-right">{String(r.unmatched_bank_transactions)}</TableCell>
                  <TableCell className="text-right">{String(r.manual_review_queue)}</TableCell>
                  <TableCell className="text-right">{money(String(r.unmatched_bank_amount), String(r.currency))}</TableCell>
                  <TableCell>
                    <form action={autoMatchAction}>
                      <input type="hidden" name="bank_account_id" value={String(r.bank_account_id)} />
                      <Button type="submit" size="sm" variant="secondary">Run</Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
              {dashboard.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No bank accounts in scope.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
        <Card>
          <CardHeader><CardTitle>Ingest bank feed transaction</CardTitle></CardHeader>
          <CardContent>
            <form action={ingestBankFeedAction} className="space-y-4">
              <Field label="Bank account" required>
                <Select name="bank_account_id" required>
                  <option value="">Select bank</option>
                  {bankAccounts.map((b: Row) => (
                    <option key={String(b.id)} value={String(b.id)}>
                      {b.entity_name} | {b.bank_name} | {b.currency}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Entity">
                <Select name="entity_id" required>
                  {bankAccounts.map((b: Row) => (
                    <option key={String(b.id)} value={String(b.entity_id)}>{b.entity_name}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Provider">
                  <Select name="provider" defaultValue="manual">
                    <option value="mono">Mono</option>
                    <option value="okra">Okra</option>
                    <option value="manual">Manual import</option>
                  </Select>
                </Field>
                <Field label="External ID" required><Input name="external_transaction_id" required /></Field>
                <Field label="Date"><Input name="transaction_date" type="date" defaultValue={today} /></Field>
                <Field label="Amount"><Input name="amount" type="number" step="0.01" required /></Field>
                <Field label="Currency"><Input name="currency" maxLength={3} defaultValue={String(bankAccounts[0]?.currency ?? "NGN")} /></Field>
              </div>
              <Field label="Description"><Textarea name="description" /></Field>
              <Button type="submit">Ingest transaction</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Manual matching queue</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form action={manualMatchAction} className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
              <Field label="Bank transaction" required>
                <Select name="bank_feed_transaction_id" required>
                  <option value="">Select unmatched transaction</option>
                  {unmatched.map((t: Row) => (
                    <option key={String(t.id)} value={String(t.id)}>
                      {shortDate(String(t.transaction_date))} | {money(String(t.amount), String(t.currency))} | {t.bank_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Ledger line" required>
                <Select name="journal_entry_line_id" required>
                  <option value="">Select ledger line</option>
                  {candidates.map((l: Row) => (
                    <option key={String(l.id)} value={String(l.id)}>
                      {shortDate(String(l.transaction_date))} | {money(String(Number(l.debit_amount ?? 0) - Number(l.credit_amount ?? 0)), String(l.currency))} | {l.description ?? l.account_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" className="mt-6">Match</Button>
            </form>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Transaction</TableHeaderCell>
                  <TableHeaderCell>Bank</TableHeaderCell>
                  <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {unmatched.slice(0, 10).map((t: Row) => (
                  <TableRow key={String(t.id)}>
                    <TableCell>
                      <div className="font-medium">{shortDate(String(t.transaction_date))}</div>
                      <div className="font-sans text-xs text-muted-foreground">{t.description ?? "No description"}</div>
                    </TableCell>
                    <TableCell>{t.bank_name}</TableCell>
                    <TableCell className="text-right">{money(String(t.amount), String(t.currency))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Stale unreconciled operations</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Item</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Age</TableHeaderCell>
                <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {unreconciled.map((u: Row) => (
                <TableRow key={`${String(u.item_type)}-${String(u.item_id)}`}>
                  <TableCell>
                    <div className="font-medium">{humanize(String(u.item_type))}</div>
                    <div className="font-sans text-xs text-muted-foreground">{u.description}</div>
                  </TableCell>
                  <TableCell>{u.entity_name}</TableCell>
                  <TableCell>{String(u.age_days)} days</TableCell>
                  <TableCell className="text-right">{money(String(u.amount), String(u.currency))}</TableCell>
                  <TableCell><Badge variant={u.is_stale ? "solid" : "outline"}>{humanize(String(u.status))}</Badge></TableCell>
                </TableRow>
              ))}
              {unreconciled.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No unreconciled giving or expense payments.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Cash count session</CardTitle></CardHeader>
          <CardContent>
            <form action={createCashCountAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Entity" required className="sm:col-span-2">
                <Select name="entity_id" required>
                  <option value="">Select entity</option>
                  {bankAccounts.map((b: Row) => <option key={String(b.entity_id)} value={String(b.entity_id)}>{b.entity_name}</option>)}
                </Select>
              </Field>
              <Field label="Service date"><Input name="service_date" type="date" defaultValue={today} /></Field>
              <Field label="Second counter" required>
                <Select name="second_counter_id" required>
                  <option value="">Select second counter</option>
                  {users.filter((u: Row) => u.id !== ctx.user.id).map((u: Row) => (
                    <option key={String(u.id)} value={String(u.id)}>{u.email ?? u.id}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Total counted"><Input name="total_counted" type="number" min="0" step="0.01" required /></Field>
              <Field label="Currency"><Input name="currency" maxLength={3} defaultValue="NGN" /></Field>
              <Field label="Sealed bag reference" required className="sm:col-span-2"><Input name="sealed_bag_reference" required /></Field>
              <Button type="submit">Finalize count</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cash deposit</CardTitle></CardHeader>
          <CardContent>
            <form action={createCashDepositAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Cash count" required className="sm:col-span-2">
                <Select name="cash_count_session_id" required>
                  <option value="">Select count session</option>
                  {sessions.map((s: Row) => (
                    <option key={String(s.id)} value={String(s.id)}>
                      {s.entity_name} | {shortDate(String(s.service_date))} | {s.sealed_bag_reference}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Entity">
                <Select name="entity_id" required>
                  {sessions.map((s: Row) => <option key={String(s.id)} value={String(s.entity_id)}>{s.entity_name}</option>)}
                </Select>
              </Field>
              <Field label="Bank account" required>
                <Select name="bank_account_id" required>
                  <option value="">Select bank</option>
                  {bankAccounts.map((b: Row) => <option key={String(b.id)} value={String(b.id)}>{b.bank_name} | {b.entity_name}</option>)}
                </Select>
              </Field>
              <Field label="Deposited amount"><Input name="deposited_amount" type="number" min="0" step="0.01" required /></Field>
              <Field label="Deposit date"><Input name="deposit_date" type="date" defaultValue={today} /></Field>
              <Field label="Deposit slip reference" required className="sm:col-span-2"><Input name="deposit_slip_reference" required /></Field>
              <Button type="submit">Record deposit</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Cash variance report</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Session</TableHeaderCell>
                <TableHeaderCell>Deposit</TableHeaderCell>
                <TableHeaderCell className="text-right">Counted</TableHeaderCell>
                <TableHeaderCell className="text-right">Deposited</TableHeaderCell>
                <TableHeaderCell className="text-right">Variance</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {variances.map((v: Row) => (
                <TableRow key={String(v.cash_count_session_id)}>
                  <TableCell>
                    <div className="font-medium">{v.entity_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">{shortDate(String(v.service_date))} | {v.sealed_bag_reference}</div>
                  </TableCell>
                  <TableCell>
                    {v.cash_deposit_id ? (
                      <div>
                        <div className="font-medium">{v.deposit_slip_reference}</div>
                        <div className="font-sans text-xs text-muted-foreground">{shortDate(String(v.deposit_date))} | {v.bank_name}</div>
                      </div>
                    ) : "Not deposited"}
                  </TableCell>
                  <TableCell className="text-right">{money(String(v.total_counted), String(v.currency))}</TableCell>
                  <TableCell className="text-right">{money(String(v.deposited_amount ?? 0), String(v.currency))}</TableCell>
                  <TableCell className="text-right">{money(String(v.variance ?? 0), String(v.currency))}</TableCell>
                  <TableCell><Badge variant={v.variance_status === "review_required" ? "solid" : "outline"}>{humanize(String(v.variance_status ?? "pending_deposit"))}</Badge></TableCell>
                </TableRow>
              ))}
              {variances.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No cash count sessions yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
