import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { MfaManager } from "@/components/security/MfaManager";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Account
        </div>
        <h2 className="font-display text-3xl tracking-display text-ink">Security</h2>
        <p className="max-w-xl font-sans text-sm leading-relaxed text-muted-foreground">
          Two-factor authentication for your account. Once enrolled, approving
          requisitions and signing disbursements require a verified session —
          a stolen password alone can no longer move money.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>Authenticator app (TOTP) — Google Authenticator, 1Password, Authy</CardDescription>
        </CardHeader>
        <CardContent>
          <MfaManager />
        </CardContent>
      </Card>
    </div>
  );
}
