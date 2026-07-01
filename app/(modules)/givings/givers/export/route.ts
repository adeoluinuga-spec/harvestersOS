import { NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { parseSelection, toCsv } from "@/lib/bulk";
import { giverIdsMatching, giversForExport } from "@/lib/givings";

// POST — export selected givers (or all matching) as CSV.
export async function POST(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const form = await req.formData();
  const { ids, allMatching, filter } = parseSelection(form);
  const target = allMatching ? await giverIdsMatching(filter.q ?? "") : ids;
  const rows = (await giversForExport(target)) as Record<string, unknown>[];

  const csv = toCsv(rows, ["full_name", "phone", "email", "date_of_birth", "primary_campus", "created_at"]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="givers_export.csv"`,
    },
  });
}
