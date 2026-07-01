import Link from "next/link";
import { NaturalLanguageQuery } from "../_components/NaturalLanguageQuery";

export const dynamic = "force-dynamic";

export default function AnalyticsQueryPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="font-display text-3xl tracking-display text-ink">Ask the ledger</h2>
          <p className="font-sans text-sm text-muted-foreground">
            Natural-language analytics for scoped, read-only SQL against approved reporting views.
          </p>
        </div>
        <Link href="/analytics" className="font-sans text-sm text-muted-foreground hover:text-ink">
          Back to analytics
        </Link>
      </div>
      <NaturalLanguageQuery />
    </div>
  );
}
