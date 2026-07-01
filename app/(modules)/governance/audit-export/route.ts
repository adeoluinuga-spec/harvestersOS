import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAuditLogRows } from "@/lib/governance";

const GOVERNANCE_ROLES = new Set([
  "super_admin",
  "auditor",
  "governance_officer",
  "board_trustee",
  "cfo_coo",
  "global_lead_pastor",
]);

const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function GET(req: Request) {
  const ctx = await requireUser();
  if (!ctx.roles.some((r) => GOVERNANCE_ROLES.has(r.role))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const url = new URL(req.url);
  const rows = await getAuditLogRows({
    scope: ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds,
    entityId: url.searchParams.get("entity_id"),
    action: url.searchParams.get("action"),
    startDate: url.searchParams.get("start_date"),
    endDate: url.searchParams.get("end_date"),
  });
  const header = ["occurred_at","actor","action","table_name","record_id","entity","note"];
  const body = rows.map((r: Record<string, unknown>) =>
    [
      r.occurred_at,
      r.actor_email ?? r.actor_id,
      r.action,
      r.table_name,
      r.record_id,
      r.entity_name ?? r.entity_id,
      r.note,
    ].map(csv).join(",")
  );
  return new NextResponse([header.join(","), ...body].join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=audit-log.csv",
    },
  });
}
