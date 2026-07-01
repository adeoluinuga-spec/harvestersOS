import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { NAV_SECTIONS } from "@/lib/navigation";

/**
 * Dashboard (Overview) — Phase 0 landing surface.
 * Presentational only: it links into the module shells and states the system's
 * founding principle. No metrics, data, or ledger reads yet.
 */
export default function DashboardPage() {
  const modules = NAV_SECTIONS.flatMap((s) => s.items).filter(
    (i) => i.href !== "/"
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <section className="space-y-3">
        <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Harvesters International Christian Centre
        </div>
        <h2 className="font-display text-4xl tracking-display text-ink">
          Finance OS
        </h2>
        <p className="max-w-2xl font-sans text-sm leading-relaxed text-muted-foreground">
          A ledger-grade financial operating system. Every module posts to one
          immutable, append-only double-entry ledger — balances are always
          derived, never written, and corrections are reversing entries.
        </p>
      </section>

      <section className="rounded-md border-l-2 border-silver bg-paper px-5 py-4">
        <p className="font-sans text-sm text-ink-700">
          <span className="font-semibold">Foundation:</span> nothing is ever
          deleted. This single rule — enforced from the ledger up — is what makes
          audit, compliance, and &ldquo;who changed what&rdquo; possible without a
          rebuild.
        </p>
      </section>

      <section className="space-y-4">
        <h3 className="font-display text-lg tracking-display text-ink">
          Modules
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <Link key={m.href} href={m.href} className="group">
              <Card className="h-full transition-colors group-hover:border-ink">
                <CardHeader className="border-b-0 pb-0">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded border border-paper-200 bg-paper-50 font-display text-xs text-ink">
                      {m.glyph}
                    </span>
                    <CardTitle className="text-sm">{m.label}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-3">
                  <CardDescription>Open module →</CardDescription>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
