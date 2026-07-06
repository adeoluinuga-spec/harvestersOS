import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { GIVING_CHANNELS } from "@/lib/enums";
import { getGivingTypes } from "@/lib/givings";
import { getEntities } from "@/lib/repo";
import { BatchGrid } from "./_components/BatchGrid";

export const dynamic = "force-dynamic";

/** Spreadsheet-style Sunday entry for clerks: type, Enter, type, Enter. */
export default async function BatchGivingPage() {
  const ctx = await requireUser();
  const scope = ctx.isSuperAdmin || ctx.isAuditor ? ("all" as const) : ctx.accessibleEntityIds;
  const [entities, types] = await Promise.all([getEntities(scope), getGivingTypes()]);
  const entityOptions = entities
    .filter((e) => e.is_active && e.type === "campus")
    .map((e) => ({ id: e.id, name: e.name, functional_currency: e.functional_currency }));
  const allOptions = entityOptions.length
    ? entityOptions
    : entities.filter((e) => e.is_active).map((e) => ({ id: e.id, name: e.name, functional_currency: e.functional_currency }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <Link href="/givings" className="font-sans text-xs text-muted-foreground hover:text-ink">
          ← Givings
        </Link>
        <h2 className="font-display text-3xl tracking-display text-ink">Batch service entry</h2>
        <p className="max-w-2xl font-sans text-sm leading-relaxed text-muted-foreground">
          Built for the Sunday count: keyboard-first, one row per gift, Enter to keep moving.
          Every row resolves through the giver identity engine, posts to the ledger, and is
          idempotent — a retried submit can never double-record.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Entry grid</CardTitle>
          <CardDescription>
            Set campus / date / type / channel once, then enter gifts. Blank name = anonymous.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BatchGrid
            entities={allOptions}
            givingTypes={types.map((t) => ({ id: t.id, name: t.name }))}
            channels={[...GIVING_CHANNELS]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
