import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { getSignedDocumentUrl } from "@/lib/documents";

export const dynamic = "force-dynamic";

/** Scope-checked download: redirects to a 5-minute signed URL. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = ctx.isSuperAdmin || ctx.isAuditor ? ("all" as const) : ctx.accessibleEntityIds;
  const doc = await getSignedDocumentUrl(params.id, scope);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.redirect(doc.url);
}
