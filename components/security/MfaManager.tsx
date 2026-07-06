"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; friendly_name?: string | null; status: string };

/**
 * TOTP enrollment & verification (Supabase MFA). Once a factor is verified,
 * approval and bank-signature actions require an AAL2 session — signing in
 * (or re-verifying here) with the authenticator code satisfies it.
 */
export function MfaManager() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [aal, setAal] = useState<{ current: string; next: string } | null>(null);
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data: f }, { data: level }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    setFactors((f?.totp ?? []) as Factor[]);
    if (level) setAal({ current: level.currentLevel ?? "aal1", next: level.nextLevel ?? "aal1" });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function startEnroll() {
    setBusy(true); setError(null); setMessage(null);
    const supabase = createClient();
    const { data, error: err } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
    });
    setBusy(false);
    if (err || !data) { setError(err?.message ?? "Enrollment failed."); return; }
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verifyEnroll() {
    if (!enroll) return;
    setBusy(true); setError(null);
    const supabase = createClient();
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: enroll.factorId });
    if (chErr || !ch) { setBusy(false); setError(chErr?.message ?? "Challenge failed."); return; }
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: enroll.factorId,
      challengeId: ch.id,
      code: code.trim(),
    });
    setBusy(false);
    if (vErr) { setError(vErr.message); return; }
    setEnroll(null); setCode("");
    setMessage("Two-factor authentication is now active. Approvals and signatures will require it.");
    await refresh();
  }

  async function stepUp(factorId: string) {
    setBusy(true); setError(null);
    const supabase = createClient();
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
    if (chErr || !ch) { setBusy(false); setError(chErr?.message ?? "Challenge failed."); return; }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
    setBusy(false);
    if (vErr) { setError(vErr.message); return; }
    setCode("");
    setMessage("Session verified at the highest assurance level.");
    await refresh();
  }

  async function unenroll(factorId: string) {
    setBusy(true); setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setMessage("Factor removed.");
    await refresh();
  }

  const verified = factors.filter((f) => f.status === "verified");
  const needsStepUp = aal && aal.current !== aal.next && verified.length > 0;

  return (
    <div className="space-y-5">
      {message && (
        <p className="rounded border border-status-success/30 bg-status-success-bg px-3 py-2 font-sans text-xs text-status-success">{message}</p>
      )}
      {error && (
        <p className="rounded border border-status-danger/30 bg-status-danger-bg px-3 py-2 font-sans text-xs text-status-danger">{error}</p>
      )}

      <div className="rounded-md border border-paper-200 bg-paper-50 p-4">
        <div className="font-sans text-sm font-semibold text-ink">Status</div>
        <p className="mt-1 font-sans text-sm text-muted-foreground">
          {verified.length === 0
            ? "No authenticator enrolled. Approvers and bank signatories should enroll one — approvals stay available until then, but the account is password-only."
            : needsStepUp
              ? "Authenticator enrolled, but this session has not been verified with a code yet. Approvals and signatures will ask for it."
              : "Two-factor authentication active and this session is fully verified."}
        </p>
        {aal && (
          <p className="mt-1 font-sans text-xs text-muted-foreground">
            Session level: {aal.current.toUpperCase()} · required: {aal.next.toUpperCase()}
          </p>
        )}
      </div>

      {verified.length > 0 && (
        <div className="space-y-2">
          <div className="font-sans text-sm font-semibold text-ink">Enrolled authenticators</div>
          {factors.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded border border-paper-200 px-3 py-2">
              <div className="font-sans text-sm">{f.friendly_name ?? f.id.slice(0, 8)} <span className="text-xs text-muted-foreground">({f.status})</span></div>
              <button
                onClick={() => unenroll(f.id)}
                disabled={busy}
                className="font-sans text-xs font-semibold text-status-danger hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {needsStepUp && (
        <div className="space-y-2 rounded-md border border-status-warning/30 bg-status-warning-bg p-4">
          <div className="font-sans text-sm font-semibold text-ink">Verify this session</div>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              placeholder="6-digit code"
              className="h-10 w-32 rounded-md border border-paper-300 bg-paper px-3 font-mono text-sm"
            />
            <button
              onClick={() => stepUp(verified[0].id)}
              disabled={busy || code.trim().length < 6}
              className="rounded-md border border-ink bg-ink px-4 font-sans text-sm font-semibold text-paper disabled:opacity-50"
            >
              Verify
            </button>
          </div>
        </div>
      )}

      {!enroll ? (
        <button
          onClick={startEnroll}
          disabled={busy}
          className="rounded-md border border-ink bg-ink px-4 py-2 font-sans text-sm font-semibold text-paper shadow-lift transition-all hover:-translate-y-0.5 disabled:opacity-50"
        >
          {verified.length === 0 ? "Enroll an authenticator app" : "Enroll another device"}
        </button>
      ) : (
        <div className="space-y-3 rounded-md border border-paper-200 p-4">
          <div className="font-sans text-sm font-semibold text-ink">
            Scan with Google Authenticator / 1Password / Authy
          </div>
          {/* Supabase returns the QR as an SVG data URI */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="TOTP QR code" className="h-44 w-44 rounded bg-white p-2" />
          <p className="font-sans text-xs text-muted-foreground">
            Or enter the secret manually: <code className="rounded bg-paper-100 px-1 font-mono">{enroll.secret}</code>
          </p>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              placeholder="6-digit code"
              className="h-10 w-32 rounded-md border border-paper-300 bg-paper px-3 font-mono text-sm"
            />
            <button
              onClick={verifyEnroll}
              disabled={busy || code.trim().length < 6}
              className="rounded-md border border-ink bg-ink px-4 font-sans text-sm font-semibold text-paper disabled:opacity-50"
            >
              Confirm enrollment
            </button>
            <button
              onClick={() => { setEnroll(null); setCode(""); }}
              className="font-sans text-xs text-muted-foreground hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
