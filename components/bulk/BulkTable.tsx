"use client";

import { useMemo, useState } from "react";

export type BulkColumn = {
  key: string;
  header: string;
  className?: string;
  mono?: boolean;
};

export type BulkAction = {
  key: string;
  label: string;
  mode: "server" | "download" | "print";
  endpoint?: string; // for download/print (POST target)
  destructive?: boolean;
  confirm?: string;
};

/**
 * Generic selectable table with a bulk-action toolbar. Rows are pre-formatted
 * (string cells) by the server. Selection supports "all on page" and
 * "all N matching the current filter" (resolved server-side by id/all_matching).
 */
export function BulkTable({
  rows,
  idKey,
  columns,
  total,
  actions,
  serverAction,
  filter,
  linkColumn,
  hrefBase,
  emptyMessage = "Nothing here.",
}: {
  rows: Record<string, string>[];
  idKey: string;
  columns: BulkColumn[];
  total: number;
  actions: BulkAction[];
  serverAction?: (formData: FormData) => void | Promise<void>;
  filter?: Record<string, string | undefined>;
  linkColumn?: string; // render this column as a link to `${hrefBase}/${id}`
  hrefBase?: string;
  emptyMessage?: string;
}) {
  const pageIds = useMemo(() => rows.map((r) => r[idKey]), [rows, idKey]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);

  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedCount = allMatching ? total : selected.size;

  const toggleAllPage = () => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const idsJson = JSON.stringify(Array.from(selected));
  const filterJson = JSON.stringify(filter ?? {});

  const HiddenInputs = () => (
    <>
      <input type="hidden" name="ids" value={allMatching ? "[]" : idsJson} />
      <input type="hidden" name="all_matching" value={allMatching ? "1" : ""} />
      <input type="hidden" name="filter" value={filterJson} />
    </>
  );

  return (
    <div>
      {/* Toolbar */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-paper-200 bg-paper-50 px-4 py-2.5">
          <span className="font-sans text-xs font-semibold text-ink">
            {allMatching ? `All ${total.toLocaleString()}` : selectedCount} selected
          </span>
          {!allMatching && allPageSelected && total > pageIds.length && (
            <button
              type="button"
              onClick={() => setAllMatching(true)}
              className="font-sans text-xs text-ink underline"
            >
              Select all {total.toLocaleString()} matching
            </button>
          )}
          <button
            type="button"
            onClick={() => { setSelected(new Set()); setAllMatching(false); }}
            className="font-sans text-xs text-muted-foreground hover:text-ink"
          >
            Clear
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {actions.map((a) => (
              <form
                key={a.key}
                action={a.mode === "server" ? serverAction : a.endpoint}
                method={a.mode === "server" ? undefined : "post"}
                target={a.mode === "print" ? "_blank" : undefined}
                onSubmit={(e) => {
                  if (a.confirm && !window.confirm(a.confirm)) e.preventDefault();
                }}
              >
                <input type="hidden" name="action_key" value={a.key} />
                <HiddenInputs />
                <button
                  type="submit"
                  className={
                    "rounded px-2.5 py-1 font-sans text-xs font-medium transition-colors " +
                    (a.destructive
                      ? "border border-status-danger/40 bg-paper text-status-danger hover:bg-status-danger-bg"
                      : "border border-silver bg-paper text-ink hover:border-ink")
                  }
                >
                  {a.label}
                </button>
              </form>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              <th className="border-b border-silver px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleAllPage}
                  aria-label="Select all on page"
                />
              </th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="border-b border-silver px-4 py-3 font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-6 font-sans text-sm text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const id = r[idKey];
              const checked = allMatching || selected.has(id);
              return (
                <tr key={id} className="border-b border-paper-200 hover:bg-paper-50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(id)}
                      aria-label="Select row"
                    />
                  </td>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={
                        "px-4 py-3 align-middle text-ink " +
                        (c.mono ? "font-mono text-xs " : "") +
                        (c.className ?? "")
                      }
                    >
                      {c.key === linkColumn && hrefBase ? (
                        <a href={`${hrefBase}/${id}`} className="font-medium text-ink hover:underline">
                          {r[c.key]}
                        </a>
                      ) : (
                        r[c.key]
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
