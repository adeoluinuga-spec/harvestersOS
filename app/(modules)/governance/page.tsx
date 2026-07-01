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
  getAuditLogRows,
  getEntitiesForGovernance,
  getGovernanceDashboard,
  getStaffForGovernance,
  getTrusteeUsers,
} from "@/lib/governance";
import {
  createConflictAction,
  createWhistleblowerAction,
  reviewConflictAction,
  updateWhistleblowerAction,
  upsertScumlAction,
} from "./actions";

export const dynamic = "force-dynamic";

type Row = Record<string, string | number | boolean | null>;

const GOVERNANCE_ROLES = new Set([
  "super_admin",
  "auditor",
  "governance_officer",
  "board_trustee",
  "cfo_coo",
  "global_lead_pastor",
]);

export default async function GovernancePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireUser();
  const canGovern = ctx.roles.some((r) => GOVERNANCE_ROLES.has(r.role));
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;

  if (!canGovern) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <WhistleblowerCard today={today} />
      </div>
    );
  }

  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const entityId = String(searchParams?.entity_id ?? "") || null;
  const action = String(searchParams?.action ?? "") || null;
  const startDate = String(searchParams?.start_date ?? yearStart);
  const endDate = String(searchParams?.end_date ?? today);
  const [dashboard, entities, staff, trustees, auditRows] = await Promise.all([
    getGovernanceDashboard(scope),
    getEntitiesForGovernance(scope),
    getStaffForGovernance(scope),
    getTrusteeUsers(),
    getAuditLogRows({ scope, entityId, action, startDate, endDate }),
  ]);
  const csvHref = `/governance/audit-export?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}${entityId ? `&entity_id=${encodeURIComponent(entityId)}` : ""}${action ? `&action=${encodeURIComponent(action)}` : ""}`;
  const printHref = `/governance/audit-print?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}${entityId ? `&entity_id=${encodeURIComponent(entityId)}` : ""}${action ? `&action=${encodeURIComponent(action)}` : ""}`;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="font-display text-3xl tracking-display text-ink">Governance</h2>
          <p className="font-sans text-sm text-muted-foreground">
            Regulatory flags, governance registers, whistleblower reports, and audit trail review.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href={csvHref} className="font-sans text-xs text-muted-foreground hover:text-ink">Export CSV</Link>
          <Link href={printHref} className="font-sans text-xs text-muted-foreground hover:text-ink">Print/PDF</Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="NFIU flags" value={dashboard.nfiu.length} />
        <Metric label="WHT overdue" value={dashboard.wht.filter((r: Row) => r.is_overdue).length} />
        <Metric label="Related party" value={dashboard.related.length} />
        <Metric label="Conflicts" value={dashboard.conflicts.length} />
        <Metric label="Whistleblower" value={dashboard.whistleblower.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>NFIU large cash awareness</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead><TableRow><TableHeaderCell>Transaction</TableHeaderCell><TableHeaderCell>Entity</TableHeaderCell><TableHeaderCell className="text-right">Amount</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {dashboard.nfiu.map((r: Row) => (
                  <TableRow key={`${r.transaction_type}-${r.source_id}`}>
                    <TableCell><div className="font-medium">{humanize(String(r.transaction_type))}</div><div className="font-sans text-xs text-muted-foreground">{shortDate(String(r.transaction_date))} | {r.description}</div></TableCell>
                    <TableCell>{r.entity_name}</TableCell>
                    <TableCell className="text-right">{money(String(r.amount), String(r.currency))}</TableCell>
                  </TableRow>
                ))}
                {dashboard.nfiu.length === 0 && <TableRow><TableCell colSpan={3} className="text-muted-foreground">No large cash transactions flagged.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>WHT remittance dashboard</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHead><TableRow><TableHeaderCell>Entity/month</TableHeaderCell><TableHeaderCell className="text-right">Outstanding</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {dashboard.wht.map((r: Row) => (
                  <TableRow key={`${r.entity_id}-${r.remittance_month}`}>
                    <TableCell><div className="font-medium">{r.entity_name}</div><div className="font-sans text-xs text-muted-foreground">{shortDate(String(r.remittance_month))}</div></TableCell>
                    <TableCell className="text-right">{money(String(r.outstanding_amount), "NGN")}</TableCell>
                    <TableCell><Badge variant={r.is_overdue ? "solid" : "outline"}>{r.is_overdue ? "Overdue" : humanize(String(r.status))}</Badge></TableCell>
                  </TableRow>
                ))}
                {dashboard.wht.length === 0 && <TableRow><TableCell colSpan={3} className="text-muted-foreground">No WHT remittance rows yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>SCUML filing log</CardTitle></CardHeader>
          <CardContent>
            <form action={upsertScumlAction} className="space-y-4">
              <EntitySelect entities={entities} />
              <Field label="Status">
                <Select name="registration_status" defaultValue="registered">
                  {["not_required","pending_registration","registered","filing_due","filed","overdue"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </Select>
              </Field>
              <Field label="Registration number"><Input name="registration_number" /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Registered"><Input name="registration_date" type="date" /></Field>
                <Field label="Next due"><Input name="next_filing_due_date" type="date" /></Field>
              </div>
              <Field label="Last filing"><Input name="last_filing_date" type="date" /></Field>
              <Field label="Notes"><Textarea name="notes" /></Field>
              <Button type="submit">Save SCUML log</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Conflict registry</CardTitle></CardHeader>
          <CardContent>
            <form action={createConflictAction} className="space-y-4">
              <Field label="Trustee">
                <Select name="trustee_id"><option value="">No trustee</option>{trustees.map((u: Row) => <option key={String(u.id)} value={String(u.id)}>{u.email}</option>)}</Select>
              </Field>
              <Field label="Staff">
                <Select name="staff_id"><option value="">No staff</option>{staff.map((s: Row) => <option key={String(s.id)} value={String(s.id)}>{s.full_name} | {s.entity_name}</option>)}</Select>
              </Field>
              <Field label="Declared interest" required><Textarea name="declared_interest" required /></Field>
              <Field label="Date declared"><Input name="date_declared" type="date" defaultValue={today} /></Field>
              <Button type="submit">Register conflict</Button>
            </form>
          </CardContent>
        </Card>

        <WhistleblowerCard today={today} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Related-party disclosures</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.related.map((r: Row) => (
              <div key={String(r.id)} className="border-b border-paper-200 pb-3 last:border-0">
                <div className="flex items-center justify-between gap-3"><div className="font-medium">{r.vendor_name}</div><Badge variant="outline">{humanize(String(r.status))}</Badge></div>
                <div className="font-sans text-xs text-muted-foreground">{r.entity_name ?? "No entity"} | {shortDate(String(r.created_at))}</div>
                <p className="mt-2 font-sans text-sm text-ink">{r.disclosure_note}</p>
              </div>
            ))}
            {dashboard.related.length === 0 && <div className="font-sans text-sm text-muted-foreground">No related-party disclosures yet.</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Whistleblower reports</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.whistleblower.map((r: Row) => (
              <form key={String(r.id)} action={updateWhistleblowerAction} className="grid gap-2 rounded border border-paper-200 p-3">
                <input type="hidden" name="report_id" value={String(r.id)} />
                <div className="flex items-center justify-between gap-3">
                  <div><div className="font-medium">{humanize(String(r.category))}</div><div className="font-sans text-xs text-muted-foreground">{shortDate(String(r.received_at))}</div></div>
                  <Badge variant="outline">{humanize(String(r.status))}</Badge>
                </div>
                <Select name="status" defaultValue={String(r.status)}>
                  <option value="submitted">Submitted</option>
                  <option value="under_review">Under review</option>
                  <option value="resolved">Resolved</option>
                </Select>
                <Input name="resolution_note" placeholder="Resolution note" />
                <Button type="submit" size="sm" variant="secondary">Update</Button>
              </form>
            ))}
            {dashboard.whistleblower.length === 0 && <div className="font-sans text-sm text-muted-foreground">No whistleblower reports submitted.</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Audit log viewer</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form action="/governance" method="get" className="grid gap-4 lg:grid-cols-5">
            <Field label="Entity">
              <Select name="entity_id" defaultValue={entityId ?? ""}>
                <option value="">All entities</option>
                {entities.map((e: Row) => <option key={String(e.id)} value={String(e.id)}>{e.name}</option>)}
              </Select>
            </Field>
            <Field label="Action"><Input name="action" defaultValue={action ?? ""} placeholder="create, update, approve" /></Field>
            <Field label="Start"><Input name="start_date" type="date" defaultValue={startDate} /></Field>
            <Field label="End"><Input name="end_date" type="date" defaultValue={endDate} /></Field>
            <Button type="submit" className="mt-6">Filter</Button>
          </form>
          <Table>
            <TableHead><TableRow><TableHeaderCell>When</TableHeaderCell><TableHeaderCell>Actor</TableHeaderCell><TableHeaderCell>Action</TableHeaderCell><TableHeaderCell>Record</TableHeaderCell><TableHeaderCell>Entity</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {auditRows.map((a: Row) => (
                <TableRow key={String(a.id)}>
                  <TableCell>{shortDate(String(a.occurred_at))}</TableCell>
                  <TableCell>{a.actor_email ?? a.actor_id ?? "System"}</TableCell>
                  <TableCell><Badge variant="outline">{humanize(String(a.action))}</Badge></TableCell>
                  <TableCell>{a.table_name} / {a.record_id}</TableCell>
                  <TableCell>{a.entity_name ?? "-"}</TableCell>
                </TableRow>
              ))}
              {auditRows.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No audit rows for this filter.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Conflict review</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {dashboard.conflicts.map((c: Row) => (
            <form key={String(c.id)} action={reviewConflictAction} className="grid gap-3 rounded border border-paper-200 p-3 sm:grid-cols-[1fr_180px_auto]">
              <input type="hidden" name="conflict_id" value={String(c.id)} />
              <div><div className="font-medium">{c.trustee_email ?? c.staff_name ?? "Declared subject"}</div><div className="font-sans text-xs text-muted-foreground">{shortDate(String(c.date_declared))} | {c.declared_interest}</div></div>
              <Select name="status" defaultValue={String(c.status)}>
                <option value="reviewed">Reviewed</option>
                <option value="mitigated">Mitigated</option>
                <option value="closed">Closed</option>
              </Select>
              <Button type="submit" size="sm" variant="secondary">Save</Button>
            </form>
          ))}
          {dashboard.conflicts.length === 0 && <div className="font-sans text-sm text-muted-foreground">No conflict declarations yet.</div>}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent>
        <div className="font-sans text-xs uppercase text-muted-foreground">{label}</div>
        <div className="mt-2 font-display text-3xl tracking-display text-ink">{value}</div>
      </CardContent>
    </Card>
  );
}

function EntitySelect({ entities }: { entities: Row[] }) {
  return (
    <Field label="Entity" required>
      <Select name="entity_id" required>
        <option value="">Select entity</option>
        {entities.map((e) => <option key={String(e.id)} value={String(e.id)}>{e.name}</option>)}
      </Select>
    </Field>
  );
}

function WhistleblowerCard({ today }: { today: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>Whistleblower report</CardTitle></CardHeader>
      <CardContent>
        <form action={createWhistleblowerAction} className="space-y-4">
          <label className="flex items-center gap-2 rounded border border-paper-300 px-3 py-2 font-sans text-sm">
            <input name="is_anonymous" type="checkbox" className="h-4 w-4" defaultChecked />
            Anonymous
          </label>
          <Field label="Contact"><Input name="reporter_contact" placeholder="Optional email or phone" /></Field>
          <Field label="Category">
            <Select name="category" defaultValue="financial_misconduct">
              {["fraud","harassment","financial_misconduct","safeguarding","conflict_of_interest","other"].map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
            </Select>
          </Field>
          <Field label="Description" required><Textarea name="description" required /></Field>
          <input type="hidden" name="submitted_on" value={today} />
          <Button type="submit">Submit report</Button>
        </form>
      </CardContent>
    </Card>
  );
}
