import Link from "next/link";
import { Card, CardContent, Input } from "@/components/ui";
import { Pagination } from "@/components/Pagination";
import { BulkTable, type BulkAction } from "@/components/bulk/BulkTable";
import { ImportButton } from "@/components/ImportButton";
import { requireUser, type AuthContext } from "@/lib/auth";
import { searchGiversPaged } from "@/lib/givings";
import { bulkGivers } from "./actions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

const FINANCE = ["group_finance_officer", "sub_group_finance_officer", "campus_finance_officer"];
const canManage = (ctx: AuthContext) =>
  ctx.isSuperAdmin || ctx.roles.some((r) => FINANCE.includes(r.role));

export default async function GiversPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string };
}) {
  const ctx = await requireUser();
  const q = (searchParams.q ?? "").trim();
  const page = Math.max(1, Number(searchParams.page) || 1);

  const { rows, total } = await searchGiversPaged(q, page, PAGE_SIZE);

  const tableRows = rows.map((g) => ({
    id: g.id,
    full_name: g.full_name,
    phone: g.phone ?? "—",
    email: g.email ?? "—",
  }));

  const manage = canManage(ctx);
  const actions: BulkAction[] = [
    { key: "export", label: "Export CSV", mode: "download", endpoint: "/givings/givers/export" },
    { key: "print", label: "Print statements", mode: "print", endpoint: "/givings/givers/print" },
    ...(manage
      ? ([
          { key: "email", label: "Email (opens your mail app)", mode: "print", endpoint: "/givings/givers/mailto" },
          {
            key: "deactivate",
            label: "Deactivate",
            mode: "server",
            destructive: true,
            confirm: "Deactivate the selected givers? Their giving history is preserved (never deleted).",
          },
        ] as BulkAction[])
      : []),
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <Link href="/givings" className="font-sans text-xs text-muted-foreground hover:text-ink">
            ← Givings
          </Link>
          <h2 className="font-display text-3xl tracking-display text-ink">Givers</h2>
          <p className="font-sans text-sm text-muted-foreground">
            {total.toLocaleString()} givers. Select rows for bulk export, print or
            email — or select all matching your search. Email opens in your own mail app.
          </p>
        </div>
        <ImportButton type="givers" label="Import givers" />
      </div>

      <form method="get" className="flex gap-2">
        <Input name="q" defaultValue={q} placeholder="Search name, phone, email…" className="w-64" />
        <button type="submit" className="rounded border border-silver bg-paper px-4 font-sans text-sm text-ink hover:border-ink">
          Search
        </button>
      </form>

      <Card>
        <CardContent className="p-0">
          <BulkTable
            rows={tableRows}
            idKey="id"
            columns={[
              { key: "full_name", header: "Name" },
              { key: "phone", header: "Phone" },
              { key: "email", header: "Email" },
            ]}
            total={total}
            actions={actions}
            serverAction={bulkGivers}
            filter={{ q }}
            linkColumn="full_name"
            hrefBase="/givings/givers"
            emptyMessage="No givers found."
          />
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            basePath="/givings/givers"
            params={{ q }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
