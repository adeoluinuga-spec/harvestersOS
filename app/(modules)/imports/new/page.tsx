import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getEntities } from "@/lib/repo";
import { IMPORT_TYPE_LIST } from "@/lib/imports/registry";
import { ImportWizard, type ImportTypeInfo } from "../_components/ImportWizard";

export const dynamic = "force-dynamic";

export default async function NewImportPage({
  searchParams,
}: {
  searchParams: { type?: string; entity?: string };
}) {
  const ctx = await requireUser();
  const entitiesRaw = await getEntities(ctx.isSuperAdmin ? "all" : ctx.accessibleEntityIds);
  const entities = entitiesRaw.map((e) => ({ id: e.id, name: e.name }));

  const types: ImportTypeInfo[] = IMPORT_TYPE_LIST.map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    entityScoped: d.entityScoped,
    columns: d.columns.map((c) => ({ key: c.key, required: c.required, help: c.help })),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link href="/imports" className="font-sans text-xs text-muted-foreground hover:text-ink">
          ← Imports
        </Link>
        <h2 className="font-display text-3xl tracking-display text-ink">New Import</h2>
        <p className="font-sans text-sm text-muted-foreground">
          Download the template, fill it in, upload, and preview before committing.
          Financial imports post to the ledger; nothing is written as a parallel balance.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Upload a spreadsheet</CardTitle>
        </CardHeader>
        <CardContent>
          <ImportWizard
            types={types}
            entities={entities}
            initialType={searchParams.type}
            initialEntity={searchParams.entity}
          />
        </CardContent>
      </Card>
    </div>
  );
}
