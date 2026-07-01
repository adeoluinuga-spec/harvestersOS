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
import { money, shortDate } from "@/lib/format";
import {
  getConsolidatedStatement,
  getCrossBorderTransfers,
  getFxRates,
  getInternationalEntities,
  getSeparateForeignEntities,
  getStatutoryStatement,
} from "@/lib/international";
import {
  addFxRateAction,
  createCrossBorderTransferAction,
  documentCrossBorderTransferAction,
} from "./actions";

export const dynamic = "force-dynamic";

type Row = Record<string, string | number | null>;

export default async function InternationalPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const mode = String(searchParams?.mode ?? "consolidated");
  const startDate = String(searchParams?.start_date ?? yearStart);
  const endDate = String(searchParams?.end_date ?? today);
  const rateDate = String(searchParams?.rate_date ?? endDate);

  const [entities, foreignEntities, fxRates, transfers] = await Promise.all([
    getInternationalEntities(scope),
    getSeparateForeignEntities(scope),
    getFxRates(),
    getCrossBorderTransfers(scope),
  ]);
  const statutoryEntityId = String(searchParams?.entity_id ?? foreignEntities[0]?.id ?? "");
  const report =
    mode === "statutory" && statutoryEntityId
      ? await getStatutoryStatement(statutoryEntityId, startDate, endDate)
      : await getConsolidatedStatement(startDate, endDate, rateDate);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-1">
        <h2 className="font-display text-3xl tracking-display text-ink">International</h2>
        <p className="font-sans text-sm text-muted-foreground">
          Multi-currency consolidation, statutory isolation, and cross-border compliance review.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Report view</CardTitle></CardHeader>
        <CardContent>
          <form action="/international" method="get" className="grid gap-4 lg:grid-cols-6">
            <Field label="Mode">
              <Select name="mode" defaultValue={mode}>
                <option value="consolidated">Consolidated NGN</option>
                <option value="statutory">Statutory entity</option>
              </Select>
            </Field>
            <Field label="Statutory entity" className="lg:col-span-2">
              <Select name="entity_id" defaultValue={statutoryEntityId}>
                <option value="">Select entity</option>
                {foreignEntities.map((e: Row) => (
                  <option key={String(e.id)} value={String(e.id)}>
                    {e.name} ({e.statutory_jurisdiction ?? e.country})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Start"><Input name="start_date" type="date" defaultValue={startDate} /></Field>
            <Field label="End"><Input name="end_date" type="date" defaultValue={endDate} /></Field>
            <Field label="Rate date"><Input name="rate_date" type="date" defaultValue={rateDate} /></Field>
            <Button type="submit">Run report</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{mode === "statutory" ? "Statutory view" : "Consolidated view"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Account</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell className="text-right">Debit</TableHeaderCell>
                <TableHeaderCell className="text-right">Credit</TableHeaderCell>
                <TableHeaderCell className="text-right">Net</TableHeaderCell>
                {mode !== "statutory" && <TableHeaderCell className="text-right">CTA</TableHeaderCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {report.map((r: Row, idx: number) => {
                const currency = mode === "statutory" ? String(r.currency ?? "NGN") : "NGN";
                return (
                  <TableRow key={`${String(r.entity_id)}-${String(r.account_code)}-${idx}`}>
                    <TableCell>
                      <div className="font-medium">{r.entity_name}</div>
                      {r.row_type && <div className="font-sans text-xs text-muted-foreground">{humanize(String(r.row_type))}</div>}
                      {r.statutory_jurisdiction && <div className="font-sans text-xs text-muted-foreground">{r.statutory_jurisdiction}</div>}
                    </TableCell>
                    <TableCell>{r.account_code} {r.account_name}</TableCell>
                    <TableCell>{humanize(String(r.account_type))}</TableCell>
                    <TableCell className="text-right">
                      {money(String(r.historical_debit_ngn ?? r.debit_amount ?? 0), currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      {money(String(r.historical_credit_ngn ?? r.credit_amount ?? 0), currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      {money(String(r.net_historical_ngn ?? r.net_amount ?? 0), currency)}
                    </TableCell>
                    {mode !== "statutory" && (
                      <TableCell className="text-right">
                        {r.currency_translation_adjustment_ngn
                          ? money(String(r.currency_translation_adjustment_ngn), "NGN")
                          : "-"}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {report.length === 0 && (
                <TableRow><TableCell colSpan={mode === "statutory" ? 6 : 7} className="text-muted-foreground">No posted ledger activity in this period.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[0.7fr_1.3fr]">
        <Card>
          <CardHeader><CardTitle>FX rate capture</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <form action={addFxRateAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Pair"><Input name="currency_pair" defaultValue="GBP/NGN" maxLength={7} /></Field>
              <Field label="Rate"><Input name="rate" type="number" min="0.0000000001" step="0.0000000001" required /></Field>
              <Field label="Effective date"><Input name="effective_date" type="date" defaultValue={today} /></Field>
              <Field label="Source"><Input name="source" defaultValue="manual" /></Field>
              <Button type="submit">Add rate</Button>
            </form>
            <div className="space-y-2">
              {fxRates.slice(0, 8).map((r: Row) => (
                <div key={String(r.id)} className="flex items-center justify-between gap-3 border-b border-paper-200 pb-2 last:border-0">
                  <div>
                    <div className="font-medium">{r.currency_pair}</div>
                    <div className="font-sans text-xs text-muted-foreground">{shortDate(String(r.effective_date))} | {r.source}</div>
                  </div>
                  <div className="font-mono text-sm">{String(r.rate)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cross-border transfer request</CardTitle></CardHeader>
          <CardContent>
            <form action={createCrossBorderTransferAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Sending entity" required className="lg:col-span-2">
                <Select name="sending_entity_id" required>
                  <option value="">Select sender</option>
                  {entities.map((e: Row) => <option key={String(e.id)} value={String(e.id)}>{e.name}</option>)}
                </Select>
              </Field>
              <Field label="Receiving entity" required className="lg:col-span-2">
                <Select name="receiving_entity_id" required>
                  <option value="">Select receiver</option>
                  {entities.map((e: Row) => <option key={String(e.id)} value={String(e.id)}>{e.name}</option>)}
                </Select>
              </Field>
              <Field label="Direction">
                <Select name="direction" defaultValue="hq_to_international">
                  <option value="hq_to_international">HQ to international</option>
                  <option value="international_to_hq">International to HQ</option>
                </Select>
              </Field>
              <Field label="Purpose">
                <Select name="purpose" defaultValue="seed_funding">
                  <option value="seed_funding">Seed funding</option>
                  <option value="covering_remittance">Covering remittance</option>
                  <option value="missions_support">Missions support</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field label="Amount"><Input name="amount" type="number" min="0.01" step="0.01" required /></Field>
              <Field label="Currency"><Input name="currency" defaultValue="NGN" maxLength={3} /></Field>
              <Field label="Documentation URL" className="lg:col-span-4">
                <Input name="supporting_documentation_url" placeholder="https://..." />
              </Field>
              <Button type="submit">Request transfer</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Compliance dashboard</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Transfer</TableHeaderCell>
                <TableHeaderCell>Purpose</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                <TableHeaderCell>Documentation</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {transfers.map((t: Row) => (
                <TableRow key={String(t.id)}>
                  <TableCell>
                    <div className="font-medium">{t.sending_entity_name} to {t.receiving_entity_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">{humanize(String(t.direction))} | {shortDate(String(t.created_at))}</div>
                  </TableCell>
                  <TableCell>{humanize(String(t.purpose))}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{humanize(String(t.compliance_status))}</Badge>
                    {t.approved_by_email && <div className="mt-1 font-sans text-xs text-muted-foreground">By {t.approved_by_email}</div>}
                  </TableCell>
                  <TableCell className="text-right">{money(String(t.amount), String(t.currency))}</TableCell>
                  <TableCell className="min-w-[300px]">
                    {t.supporting_documentation_url ? (
                      <a href={String(t.supporting_documentation_url)} className="font-sans text-xs text-muted-foreground hover:text-ink" target="_blank">
                        Open documentation
                      </a>
                    ) : (
                      <form action={documentCrossBorderTransferAction} className="grid gap-2">
                        <input type="hidden" name="transfer_id" value={String(t.id)} />
                        <Input name="supporting_documentation_url" placeholder="Documentation URL" required />
                        <div className="flex gap-2">
                          <Button type="submit" name="compliance_status" value="documented" size="sm">Document</Button>
                          <Button type="submit" name="compliance_status" value="flagged" variant="danger" size="sm">Flag</Button>
                        </div>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {transfers.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-muted-foreground">No cross-border transfers requested yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
