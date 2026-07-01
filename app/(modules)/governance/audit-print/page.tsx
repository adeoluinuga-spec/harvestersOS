import { requireUser } from "@/lib/auth";
import { humanize } from "@/lib/enums";
import { shortDate } from "@/lib/format";
import { getAuditLogRows } from "@/lib/governance";

const GOVERNANCE_ROLES = new Set([
  "super_admin",
  "auditor",
  "governance_officer",
  "board_trustee",
  "cfo_coo",
  "global_lead_pastor",
]);

type Row = Record<string, string | number | null>;

export default async function AuditPrintPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireUser();
  if (!ctx.roles.some((r) => GOVERNANCE_ROLES.has(r.role))) {
    return <div className="p-8 font-sans text-sm">Forbidden</div>;
  }
  const startDate = String(searchParams?.start_date ?? "");
  const endDate = String(searchParams?.end_date ?? "");
  const rows = await getAuditLogRows({
    scope: ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds,
    entityId: String(searchParams?.entity_id ?? "") || null,
    action: String(searchParams?.action ?? "") || null,
    startDate: startDate || null,
    endDate: endDate || null,
  });

  return (
    <main className="mx-auto max-w-6xl bg-paper p-8 text-ink print:p-0">
      <div className="mb-6">
        <h1 className="font-display text-3xl tracking-display">Audit Log</h1>
        <p className="font-sans text-sm text-muted-foreground">
          {startDate || "Beginning"} to {endDate || "now"}
        </p>
      </div>
      <table className="w-full border-collapse font-sans text-xs">
        <thead>
          <tr className="border-b border-ink">
            <th className="py-2 text-left">When</th>
            <th className="py-2 text-left">Actor</th>
            <th className="py-2 text-left">Action</th>
            <th className="py-2 text-left">Record</th>
            <th className="py-2 text-left">Entity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: Row) => (
            <tr key={String(r.id)} className="border-b border-paper-200">
              <td className="py-2">{shortDate(String(r.occurred_at))}</td>
              <td className="py-2">{r.actor_email ?? r.actor_id ?? "System"}</td>
              <td className="py-2">{humanize(String(r.action))}</td>
              <td className="py-2">{r.table_name} / {r.record_id}</td>
              <td className="py-2">{r.entity_name ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
