import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listBatches, type ActorCtx } from "@/lib/imports/core";
import { IMPORT_TYPE_LIST } from "@/lib/imports/registry";
import { humanize } from "@/lib/enums";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  validated: "bg-status-warning-bg text-status-warning border-status-warning/25",
  committed: "bg-status-success-bg text-status-success border-status-success/25",
  partially_committed: "bg-status-warning-bg text-status-warning border-status-warning/25",
  failed: "bg-status-danger-bg text-status-danger border-status-danger/25",
  uploaded: "bg-status-neutral-bg text-status-neutral border-status-neutral/20",
};

export default async function ImportsPage() {
  const ctx = await requireUser();
  const actor: ActorCtx = {
    actorId: ctx.user.id,
    accessibleEntityIds: ctx.accessibleEntityIds,
    isSuperAdmin: ctx.isSuperAdmin,
  };
  const batches = await listBatches(actor);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h2 className="font-display text-3xl tracking-display text-ink">Imports</h2>
          <p className="font-sans text-sm text-muted-foreground">
            Bulk-load spreadsheets for migration and ongoing entry. Every batch is
            validated before commit and fully audited.
          </p>
        </div>
        <Link href="/imports/new">
          <Button>+ New import</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {IMPORT_TYPE_LIST.map((d) => (
          <Link key={d.key} href={`/imports/new?type=${d.key}`} className="group">
            <Card className="h-full transition-colors group-hover:border-ink">
              <CardContent className="py-3">
                <div className="font-sans text-sm font-semibold text-ink">{d.label}</div>
                <div className="mt-0.5 font-sans text-[11px] text-muted-foreground line-clamp-2">
                  {d.description}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>File</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell className="text-right">Rows</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>When</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {batches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No imports yet.
                  </TableCell>
                </TableRow>
              )}
              {batches.map((b: Record<string, string | number>) => (
                <TableRow key={b.id as string}>
                  <TableCell>
                    <Link
                      href={`/imports/${b.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {humanize(b.import_type as string)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{b.file_name}</TableCell>
                  <TableCell className="text-muted-foreground">{b.entity_name}</TableCell>
                  <TableCell className="text-right">
                    {b.committed_rows}/{b.total_rows}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        "inline-flex rounded-full border px-2 py-0.5 font-sans text-[11px] " +
                        (STATUS_STYLE[b.status as string] ?? STATUS_STYLE.uploaded)
                      }
                    >
                      {humanize(b.status as string)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {shortDate(String(b.created_at).slice(0, 10))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
