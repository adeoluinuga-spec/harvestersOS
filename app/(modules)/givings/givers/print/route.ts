import { NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { parseSelection } from "@/lib/bulk";
import { giverIdsMatching, giversForStatements } from "@/lib/givings";

// POST — printable giving-statement summary sheet for the selected givers.
export async function POST(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const form = await req.formData();
  const { ids, allMatching, filter } = parseSelection(form);
  const target = allMatching ? await giverIdsMatching(filter.q ?? "") : ids;
  const year = new Date().getFullYear();
  const list = await giversForStatements(target, year);

  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  const rows = list
    .map(
      (g) =>
        `<tr><td>${esc(g.full_name)}</td><td>${esc(g.email)}</td><td style="text-align:right">${g.currency} ${Number(
          g.total
        ).toLocaleString()}</td></tr>`
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Giving Statements ${year}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#0A0A0A;margin:32px}
      h1{font-size:18px;margin:0}.sub{color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.16em}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
      th,td{border-bottom:1px solid #eaeaea;padding:8px;text-align:left}
      th{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#666}
      @media print{.noprint{display:none}}
    </style></head><body onload="window.print()">
    <h1>HARVESTERS INTERNATIONAL CHRISTIAN CENTRE</h1>
    <div class="sub">Giving Statement Summary · ${year}</div>
    <table><thead><tr><th>Giver</th><th>Email</th><th style="text-align:right">Total ${year}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="3">No givers with email in selection.</td></tr>`}</tbody></table>
    <p class="sub" style="margin-top:24px">${list.length} statement(s)</p>
    </body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
