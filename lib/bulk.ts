import "server-only";

/** Parse a BulkTable submission (selected ids OR "all matching" + filter). */
export function parseSelection(formData: FormData): {
  ids: string[];
  allMatching: boolean;
  filter: Record<string, string>;
  actionKey: string;
} {
  const allMatching = String(formData.get("all_matching") || "") === "1";
  let ids: string[] = [];
  let filter: Record<string, string> = {};
  try {
    ids = JSON.parse(String(formData.get("ids") || "[]"));
  } catch {
    /* ignore */
  }
  try {
    filter = JSON.parse(String(formData.get("filter") || "{}"));
  } catch {
    /* ignore */
  }
  return { ids, allMatching, filter, actionKey: String(formData.get("action_key") || "") };
}

/** Build a CSV string from rows, using `headers` (defaults to first row keys). */
export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  const cols = headers ?? (rows[0] ? Object.keys(rows[0]) : []);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n"
  );
}
