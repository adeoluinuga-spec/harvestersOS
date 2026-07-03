import { NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { globalSearch } from "@/lib/search";

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return new Response("[]", { status: 401 });
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
  const hits = await globalSearch(q, scope);
  return Response.json(hits);
}
