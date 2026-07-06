import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getApprovalInbox } from "@/lib/requisitions";
import { ApprovalsQueue, type ApprovalItem } from "../_components/ApprovalsQueue";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireUser();
  const roles = Array.from(new Set(ctx.roles.map((r) => r.role)));
  const rows = await getApprovalInbox(roles);
  const mfaError = searchParams?.error === "mfa_required";

  const items: ApprovalItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    subject_type: r.subject_type,
    approver_role: r.approver_role,
    sequence_order: r.sequence_order,
    entity_name: r.entity_name,
    amount: String(r.amount),
    currency: r.currency,
    is_urgent: Boolean(r.is_urgent),
    is_board_step: Boolean(r.is_board_step),
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <Link href="/expenses" className="font-sans text-xs text-muted-foreground hover:text-ink">
          Back to requisitions
        </Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Approvals inbox</h2>
      </div>
      {mfaError && (
        <p className="rounded border border-status-danger/30 bg-status-danger-bg px-3 py-2 font-sans text-sm text-status-danger">
          Two-factor verification required — open <Link href="/account/security" className="underline">Account → Security</Link>,
          enter your authenticator code, then retry.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Ready for your role</CardTitle>
          <CardDescription>Decisions apply instantly — no page reloads between approvals</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ApprovalsQueue items={items} />
        </CardContent>
      </Card>
    </div>
  );
}
