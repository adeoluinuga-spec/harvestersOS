import Link from "next/link";

/** Server-rendered pagination that preserves existing query params. */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") qs.set(k, v);
    qs.set("page", String(p));
    return `${basePath}?${qs.toString()}`;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between border-t border-paper-200 px-4 py-3">
      <span className="font-sans text-xs text-muted-foreground">
        {from}–{to} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className="rounded border border-silver px-2.5 py-1 font-sans text-xs text-ink hover:border-ink">
            ← Prev
          </Link>
        ) : (
          <span className="rounded border border-paper-200 px-2.5 py-1 font-sans text-xs text-ink-300">← Prev</span>
        )}
        <span className="font-sans text-xs text-muted-foreground">
          Page {page} / {totalPages}
        </span>
        {page < totalPages ? (
          <Link href={href(page + 1)} className="rounded border border-silver px-2.5 py-1 font-sans text-xs text-ink hover:border-ink">
            Next →
          </Link>
        ) : (
          <span className="rounded border border-paper-200 px-2.5 py-1 font-sans text-xs text-ink-300">Next →</span>
        )}
      </div>
    </div>
  );
}
