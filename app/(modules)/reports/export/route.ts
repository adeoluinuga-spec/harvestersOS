import { requireUser } from "@/lib/auth";
import {
  reportFilename,
  reportScope,
  runReport,
  toDelimited,
  type ExportFormat,
  type ReportViewType,
} from "@/lib/reporting";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await requireUser();
  const url = new URL(req.url);
  const viewType = (url.searchParams.get("view_type") || "operational_ministry") as ReportViewType;
  const format = (url.searchParams.get("format") || "excel") as ExportFormat;
  const startDate = url.searchParams.get("start_date") || `${new Date().getFullYear()}-01-01`;
  const endDate = url.searchParams.get("end_date") || new Date().toISOString().slice(0, 10);
  const rows = await runReport({
    viewType,
    startDate,
    endDate,
    entityId: url.searchParams.get("entity_id"),
    programType: url.searchParams.get("program_type"),
    programId: url.searchParams.get("program_id"),
    scope: reportScope(ctx),
  });

  if (format === "pdf") {
    return new Response(renderPrintPackage(viewType, startDate, endDate, rows), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `inline; filename="${reportFilename(viewType, "pdf")}"`,
      },
    });
  }

  return new Response(toDelimited(rows), {
    headers: {
      "content-type": "application/vnd.ms-excel; charset=utf-8",
      "content-disposition": `attachment; filename="${reportFilename(viewType, "excel")}"`,
    },
  });
}

function renderPrintPackage(
  viewType: string,
  startDate: string,
  endDate: string,
  rows: Record<string, string | number | boolean | null>[]
) {
  const columns = Object.keys(rows[0] ?? {});
  const title = `Harvesters ${viewType.replaceAll("_", " ")} report`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; margin: 32px; }
    header { border-bottom: 1px solid #bbb; margin-bottom: 24px; padding-bottom: 16px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    p { color: #555; margin: 0; }
    table { border-collapse: collapse; width: 100%; font-size: 11px; }
    th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
    th { text-transform: uppercase; color: #555; font-size: 10px; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(startDate)} to ${escapeHtml(endDate)} | Board/trustee package</p>
  </header>
  <table>
    <thead><tr>${columns.map((c) => `<th>${escapeHtml(c.replaceAll("_", " "))}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows.map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(formatCell(row[c]))}</td>`).join("")}</tr>`).join("")}
      ${rows.length === 0 ? `<tr><td>No rows for this report selection.</td></tr>` : ""}
    </tbody>
  </table>
  <script>window.addEventListener('load', function () { window.print(); });</script>
</body>
</html>`;
}

function formatCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
