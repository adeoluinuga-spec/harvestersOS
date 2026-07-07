import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getEntityPayrollHistory } from "@/lib/payroll";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Spreadsheet of an entity's monthly payroll history (scope-checked CSV). */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const inScope =
    ctx.isSuperAdmin || ctx.isAuditor || ctx.accessibleEntityIds.includes(params.id);
  if (!inScope) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [entity] = await sql<{ name: string }[]>`
    select name from public.entities where id = ${params.id}`;
  if (!entity) return NextResponse.json({ error: "not found" }, { status: 404 });

  const history = await getEntityPayrollHistory(params.id);
  const header = [
    "Period", "Status", "Headcount", "Gross", "PAYE", "Pension", "NHF",
    "Other deductions", "Net",
  ];
  const lines = history.map((h: Record<string, string>) =>
    [
      `${String(h.period_month).padStart(2, "0")}/${h.period_year}`,
      h.status, h.headcount, h.gross, h.paye, h.pension, h.nhf,
      h.other_deductions, h.net,
    ].map(esc).join(",")
  );
  const csv = [header.join(","), ...lines].join("\r\n");
  const safeName = entity.name.replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll-${safeName}.csv"`,
    },
  });
}
