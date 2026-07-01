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
import { GIVING_CHANNELS, humanize } from "@/lib/enums";
import { money, shortDate } from "@/lib/format";
import {
  getActiveGivers,
  getNextLevelPrayersEntity,
  getPartnerDashboard,
  getPartnerDirectory,
  getPartnershipTiers,
} from "@/lib/nextLevelPrayers";
import {
  createCommitmentAction,
  createDigitalProductAction,
  createDigitalSaleAction,
  createIntercessorHonorariumAction,
  createNlpProgramAction,
  createPartnerAction,
  createTierAction,
  detectLapsesAction,
  recordPartnershipPaymentAction,
} from "./actions";

export const dynamic = "force-dynamic";

type Row = Record<string, string | number | null>;

export default async function NextLevelPrayersPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const nlp = await getNextLevelPrayersEntity(scope);

  if (!nlp) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader><CardTitle>Next Level Prayers</CardTitle></CardHeader>
          <CardContent className="font-sans text-sm text-muted-foreground">
            Next Level Prayers is not available in your entity scope.
          </CardContent>
        </Card>
      </div>
    );
  }

  const [dashboard, partners, tiers, givers] = await Promise.all([
    getPartnerDashboard(nlp.id),
    getPartnerDirectory(nlp.id),
    getPartnershipTiers(nlp.id),
    getActiveGivers(),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date();
  nextMonth.setDate(nextMonth.getDate() + 30);
  const accessEnd = nextMonth.toISOString().slice(0, 10);
  const currency = nlp.functional_currency ?? "NGN";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="font-display text-3xl tracking-display text-ink">Next Level Prayers</h2>
          <p className="font-sans text-sm text-muted-foreground">
            Ministry directorate partnerships, programs, deferred digital revenue, and intercessor honorariums.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/events" className="font-sans text-xs text-muted-foreground hover:text-ink">Events</Link>
          <Link href="/payroll/honorariums" className="font-sans text-xs text-muted-foreground hover:text-ink">Honorariums</Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Active partners", dashboard.counts.active_partners],
          ["Lapsed alerts", dashboard.counts.lapsed_partners],
          ["Paused partners", dashboard.counts.paused_partners],
          ["Total partners", dashboard.counts.total_partners],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent>
              <div className="font-sans text-xs uppercase text-muted-foreground">{label}</div>
              <div className="mt-2 font-display text-3xl tracking-display text-ink">{String(value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Financial summary</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Currency</TableHeaderCell>
                <TableHeaderCell className="text-right">Partnership</TableHeaderCell>
                <TableHeaderCell className="text-right">Digital sales</TableHeaderCell>
                <TableHeaderCell className="text-right">Deferred</TableHeaderCell>
                <TableHeaderCell className="text-right">Programs net</TableHeaderCell>
                <TableHeaderCell className="text-right">Honorariums</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {dashboard.summary.map((s: Row) => (
                <TableRow key={String(s.currency)}>
                  <TableCell>{s.currency}</TableCell>
                  <TableCell className="text-right">{money(String(s.partnership_giving), String(s.currency))}</TableCell>
                  <TableCell className="text-right">{money(String(s.digital_sales), String(s.currency))}</TableCell>
                  <TableCell className="text-right">{money(String(s.deferred_revenue), String(s.currency))}</TableCell>
                  <TableCell className="text-right">
                    {money(String(Number(s.event_revenue ?? 0) - Number(s.event_cost ?? 0)), String(s.currency))}
                  </TableCell>
                  <TableCell className="text-right">{money(String(s.honorarium_stipends), String(s.currency))}</TableCell>
                </TableRow>
              ))}
              {dashboard.summary.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-muted-foreground">No financial activity yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader><CardTitle>Partner directory</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Partner</TableHeaderCell>
                  <TableHeaderCell>Tier</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell className="text-right">Monthly</TableHeaderCell>
                  <TableHeaderCell>Last payment</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {partners.map((p: Row) => (
                  <TableRow key={String(p.partner_id)}>
                    <TableCell>
                      <div className="font-medium">{p.full_name}</div>
                      <div className="font-sans text-xs text-muted-foreground">
                        {[p.phone, p.email].filter(Boolean).join(" | ") || "No contact on file"}
                      </div>
                    </TableCell>
                    <TableCell>{p.tier_name ?? "Unassigned"}</TableCell>
                    <TableCell><Badge variant="outline">{humanize(String(p.status))}</Badge></TableCell>
                    <TableCell className="text-right">
                      {p.committed_monthly_amount
                        ? money(String(p.committed_monthly_amount), String(p.currency))
                        : "-"}
                  </TableCell>
                    <TableCell>{p.last_payment_date ? shortDate(String(p.last_payment_date)) : "-"}</TableCell>
                  </TableRow>
                ))}
                {partners.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-muted-foreground">No partners registered yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Tier breakdown</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {dashboard.tiers.map((t: Row) => (
                <div key={String(t.tier_name)} className="flex items-center justify-between gap-3 border-b border-paper-200 pb-3 last:border-0 last:pb-0">
                  <div>
                    <div className="font-medium">{t.tier_name}</div>
                    <div className="font-sans text-xs text-muted-foreground">{String(t.partner_count)} partners</div>
                  </div>
                  <div className="text-right font-medium">{money(String(t.monthly_commitment), String(t.currency ?? currency))}</div>
                </div>
              ))}
              {dashboard.tiers.length === 0 && <div className="font-sans text-sm text-muted-foreground">No tier activity yet.</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Lapsed partners</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <form action={detectLapsesAction} className="flex gap-2">
                <input type="hidden" name="entity_id" value={nlp.id} />
                <Input name="as_of" type="date" defaultValue={today} />
                <Button type="submit" variant="secondary">Check</Button>
              </form>
              {dashboard.lapsed.map((p: Row) => (
                <div key={String(p.id)} className="rounded border border-paper-200 p-3">
                  <div className="font-medium">{p.full_name}</div>
                  <div className="font-sans text-xs text-muted-foreground">
                    {p.tier_name ?? "Unassigned"} | missed {String(p.missed_periods)} periods | last {p.last_payment_date ? shortDate(String(p.last_payment_date)) : "none"}
                  </div>
                </div>
              ))}
              {dashboard.lapsed.length === 0 && <div className="font-sans text-sm text-muted-foreground">No open lapse flags.</div>}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Register partner</CardTitle></CardHeader>
          <CardContent>
            <form action={createPartnerAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="entity_id" value={nlp.id} />
              <Field label="Giver" required className="sm:col-span-2">
                <Select name="giver_id" required>
                  <option value="">Select giver identity</option>
                  {givers.map((g: Row) => <option key={String(g.id)} value={String(g.id)}>{g.full_name}</option>)}
                </Select>
              </Field>
              <Field label="Tier">
                <Select name="partnership_tier_id">
                  <option value="">Unassigned</option>
                  {tiers.map((t: Row) => <option key={String(t.id)} value={String(t.id)}>{t.name}</option>)}
                </Select>
              </Field>
              <Field label="Start date"><Input name="start_date" type="date" defaultValue={today} /></Field>
              <Field label="Status">
                <Select name="status" defaultValue="active">
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="lapsed">Lapsed</option>
                </Select>
              </Field>
              <Button type="submit" className="mt-6">Save partner</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Partnership tier</CardTitle></CardHeader>
          <CardContent>
            <form action={createTierAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="entity_id" value={nlp.id} />
              <Field label="Tier name" required><Input name="name" required /></Field>
              <Field label="Currency"><Input name="currency" maxLength={3} defaultValue={currency} /></Field>
              <Field label="Minimum monthly"><Input name="min_monthly_amount" type="number" min="0" step="0.01" defaultValue="0" /></Field>
              <Field label="Maximum monthly"><Input name="max_monthly_amount" type="number" min="0" step="0.01" /></Field>
              <Field label="Sort order"><Input name="sort_order" type="number" defaultValue="0" /></Field>
              <Button type="submit" className="mt-6">Save tier</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Monthly commitment</CardTitle></CardHeader>
          <CardContent>
            <form action={createCommitmentAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="entity_id" value={nlp.id} />
              <Field label="Partner" required className="sm:col-span-2">
                <Select name="partner_id" required>
                  <option value="">Select partner</option>
                  {partners.map((p: Row) => <option key={String(p.partner_id)} value={String(p.partner_id)}>{p.full_name}</option>)}
                </Select>
              </Field>
              <Field label="Monthly amount"><Input name="committed_monthly_amount" type="number" min="0.01" step="0.01" required /></Field>
              <Field label="Currency"><Input name="currency" maxLength={3} defaultValue={currency} /></Field>
              <Field label="Start month"><Input name="start_month" type="date" defaultValue={today} /></Field>
              <Field label="Expected day"><Input name="expected_day" type="number" min="1" max="28" defaultValue="1" /></Field>
              <Button type="submit">Save commitment</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Record partner payment</CardTitle></CardHeader>
          <CardContent>
            <form action={recordPartnershipPaymentAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="entity_id" value={nlp.id} />
              <Field label="Commitment" required className="sm:col-span-2">
                <Select name="commitment_id" required>
                  <option value="">Select commitment</option>
                  {partners.filter((p: Row) => p.commitment_id).map((p: Row) => (
                    <option key={String(p.commitment_id)} value={String(p.commitment_id)}>
                      {p.full_name} | {money(String(p.committed_monthly_amount), String(p.currency))}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount"><Input name="amount" type="number" min="0.01" step="0.01" required /></Field>
              <Field label="Currency"><Input name="currency" maxLength={3} defaultValue={currency} /></Field>
              <Field label="Channel">
                <Select name="channel" defaultValue="bank_transfer">
                  {GIVING_CHANNELS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                </Select>
              </Field>
              <Field label="Date"><Input name="transaction_date" type="date" defaultValue={today} /></Field>
              <Field label="Note" className="sm:col-span-2"><Textarea name="note" /></Field>
              <Button type="submit">Record payment</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>NLP program</CardTitle></CardHeader>
          <CardContent>
            <form action={createNlpProgramAction} className="space-y-4">
              <input type="hidden" name="entity_id" value={nlp.id} />
              <Field label="Program name" required><Input name="event_name" required /></Field>
              <Field label="Program type">
                <Select name="event_type" defaultValue="prayer_conference">
                  <option value="prayer_conference">Prayer conference</option>
                  <option value="prayer_school">Prayer school</option>
                  <option value="retreat">Retreat</option>
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start"><Input name="start_date" type="date" defaultValue={today} /></Field>
                <Field label="End"><Input name="end_date" type="date" defaultValue={today} /></Field>
              </div>
              <Field label="Attendees"><Input name="attendee_count" type="number" min="0" defaultValue="0" /></Field>
              <Field label="Status">
                <Select name="status" defaultValue="planning">
                  <option value="planning">Planning</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </Select>
              </Field>
              <Button type="submit">Create program</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Digital revenue</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <form action={createDigitalProductAction} className="space-y-4">
              <input type="hidden" name="entity_id" value={nlp.id} />
              <Field label="Product" required><Input name="name" required /></Field>
              <Field label="Type">
                <Select name="product_type" defaultValue="course">
                  <option value="devotional">Devotional</option>
                  <option value="course">Course</option>
                  <option value="subscription">Subscription</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Price"><Input name="price_amount" type="number" min="0" step="0.01" defaultValue="0" /></Field>
                <Field label="Days"><Input name="access_period_days" type="number" min="1" defaultValue="30" /></Field>
              </div>
              <Field label="Currency"><Input name="currency" maxLength={3} defaultValue={currency} /></Field>
              <Button type="submit">Save product</Button>
            </form>
            <form action={createDigitalSaleAction} className="space-y-4 border-t border-paper-200 pt-5">
              <input type="hidden" name="entity_id" value={nlp.id} />
              <Field label="Sale product" required>
                <Select name="digital_product_id" required>
                  <option value="">Select product</option>
                  {dashboard.products.map((p: Row) => <option key={String(p.id)} value={String(p.id)}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Giver">
                <Select name="giver_id">
                  <option value="">No giver</option>
                  {givers.map((g: Row) => <option key={String(g.id)} value={String(g.id)}>{g.full_name}</option>)}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount"><Input name="amount" type="number" min="0.01" step="0.01" required /></Field>
                <Field label="Currency"><Input name="currency" maxLength={3} defaultValue={currency} /></Field>
                <Field label="Sale date"><Input name="sale_date" type="date" defaultValue={today} /></Field>
                <Field label="Access starts"><Input name="access_start_date" type="date" defaultValue={today} /></Field>
              </div>
              <Field label="Access ends"><Input name="access_end_date" type="date" defaultValue={accessEnd} /></Field>
              <Button type="submit">Record sale</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Resident intercessor honorarium</CardTitle></CardHeader>
          <CardContent>
            <form action={createIntercessorHonorariumAction} className="space-y-4">
              <input type="hidden" name="entity_id" value={nlp.id} />
              <Field label="Recipient" required><Input name="recipient_name" required /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount"><Input name="amount" type="number" min="0.01" step="0.01" required /></Field>
                <Field label="Currency"><Input name="currency" maxLength={3} defaultValue={currency} /></Field>
              </div>
              <Field label="Program">
                <Select name="event_id">
                  <option value="">No program</option>
                  {dashboard.programs.map((p: Row) => <option key={String(p.entity_id)} value={String(p.entity_id)}>{p.event_name}</option>)}
                </Select>
              </Field>
              <Field label="Payment date"><Input name="payment_date" type="date" defaultValue={today} /></Field>
              <Field label="WHT amount"><Input name="wht_amount" type="number" min="0" step="0.01" defaultValue="0" /></Field>
              <label className="flex h-10 items-center gap-2 rounded border border-paper-300 px-3 font-sans text-sm">
                <input name="wht_applicable" type="checkbox" className="h-4 w-4" />
                WHT applies
              </label>
              <Button type="submit">Submit honorarium</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>NLP programs</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.programs.map((p: Row) => (
              <div key={String(p.id)} className="flex items-center justify-between gap-3 border-b border-paper-200 pb-3 last:border-0 last:pb-0">
                <div>
                  <div className="font-medium">{p.event_name}</div>
                  <div className="font-sans text-xs text-muted-foreground">
                    {humanize(String(p.event_type))} | {shortDate(String(p.start_date))} to {shortDate(String(p.end_date))}
                  </div>
                </div>
                <Badge variant="outline">{humanize(String(p.status))}</Badge>
              </div>
            ))}
            {dashboard.programs.length === 0 && <div className="font-sans text-sm text-muted-foreground">No NLP programs created yet.</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Digital sales</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.sales.map((s: Row) => (
              <div key={String(s.id)} className="border-b border-paper-200 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{s.product_name}</div>
                  <div className="font-medium">{money(String(s.amount), String(s.currency))}</div>
                </div>
                <div className="font-sans text-xs text-muted-foreground">
                  {s.giver_name ?? "No giver"} | {shortDate(String(s.access_start_date))} to {shortDate(String(s.access_end_date))}
                </div>
              </div>
            ))}
            {dashboard.sales.length === 0 && <div className="font-sans text-sm text-muted-foreground">No digital sales recorded yet.</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
