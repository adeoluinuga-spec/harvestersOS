import { NextRequest } from "next/server";
import { getImportDef } from "@/lib/imports/registry";
import { templateCsv } from "@/lib/imports/engine";

// GET /imports/template?type=givers  -> downloadable CSV template
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") || "";
  const def = getImportDef(type);
  if (!def) return new Response("Unknown import type", { status: 404 });

  return new Response(templateCsv(def), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}_template.csv"`,
    },
  });
}
