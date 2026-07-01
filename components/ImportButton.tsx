import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Reusable "Import spreadsheet" button. Drop onto any list page and point it at
 * the matching import type (and optionally a default entity).
 */
export function ImportButton({
  type,
  entity,
  label = "Import spreadsheet",
  className,
}: {
  type: string;
  entity?: string;
  label?: string;
  className?: string;
}) {
  const qs = new URLSearchParams({ type });
  if (entity) qs.set("entity", entity);
  return (
    <Link
      href={`/imports/new?${qs.toString()}`}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded border border-silver bg-paper px-3 font-sans text-xs font-medium text-ink transition-colors hover:border-ink",
        className
      )}
    >
      <span aria-hidden>↑</span>
      {label}
    </Link>
  );
}
