import "server-only";
import * as XLSX from "xlsx";
import { sql, type Exec } from "@/lib/db";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
export type Cell = string;
export type RawRow = Record<string, Cell>;
export type RowError = { field?: string; message: string };
export type Validated<T> = { ok: true; value: T } | { ok: false; errors: RowError[] };

export type TemplateColumn = {
  key: string; // normalized snake_case header
  label: string; // header shown in the template
  required?: boolean;
  help?: string; // data-dictionary note
  example?: string;
};

export type CommitResult = { rowNumber: number; targetId?: string; error?: string };

export type ImportContext = {
  actorId: string;
  accessibleEntityIds: string[];
  isSuperAdmin: boolean;
  batchEntityId: string | null;
  entitiesByName: Map<string, { id: string; currency: string }>;
  entitiesById: Map<string, { name: string; currency: string }>;
  accountsByCode: Map<string, { id: string; fund: string }>;
  givingTypesByCode: Map<string, { id: string; fund: string }>;
};

export type ImportTypeDef = {
  key: string;
  label: string;
  description: string;
  targetTable: string;
  entityScoped: boolean; // batch requires an entity context
  columns: TemplateColumn[];
  validate: (raw: RawRow, ctx: ImportContext) => Validated<unknown>;
  commit: (
    rows: { rowNumber: number; value: unknown }[],
    ctx: ImportContext,
    tx: Exec
  ) => Promise<CommitResult[]>;
};

// ---------------------------------------------------------------------------
// Header normalisation + parsing
// ---------------------------------------------------------------------------
export const normKey = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Parse the first sheet of a CSV/XLSX file into normalized-key row objects. */
export function parseSpreadsheet(buf: ArrayBuffer): RawRow[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  return json.map((r) => {
    const out: RawRow = {};
    for (const [k, v] of Object.entries(r)) {
      out[normKey(k)] = v == null ? "" : String(v).trim();
    }
    return out;
  });
}

/** Build a downloadable template sheet (headers + one example row) as CSV. */
export function templateCsv(def: ImportTypeDef): string {
  const headers = def.columns.map((c) => c.key);
  const example = def.columns.map((c) => c.example ?? "");
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return headers.map(esc).join(",") + "\n" + example.map(esc).join(",") + "\n";
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------
export const field = (raw: RawRow, key: string): string => (raw[key] ?? "").trim();

export function asNumber(v: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function asDate(v: string): string | null {
  if (!v) return null;
  // Accept YYYY-MM-DD or DD/MM/YYYY or Excel-ish; normalize to ISO date.
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(v)) return v;
  const dmy = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmy) {
    const d = dmy[1];
    const m = dmy[2];
    const y = dmy[3].length === 2 ? "20" + dmy[3] : dmy[3];
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Resolve an entity by (case-insensitive) name, restricted to what ctx allows. */
export function resolveEntity(
  ctx: ImportContext,
  name: string
): { id: string; currency: string } | null {
  const hit = ctx.entitiesByName.get(name.trim().toLowerCase());
  if (!hit) return null;
  if (!ctx.isSuperAdmin && !ctx.accessibleEntityIds.includes(hit.id)) return null;
  return hit;
}

// ---------------------------------------------------------------------------
// Context loader (one set of lookups per batch, not per row)
// ---------------------------------------------------------------------------
export async function buildContext(
  actorId: string,
  accessibleEntityIds: string[],
  isSuperAdmin: boolean,
  batchEntityId: string | null,
  exec: Exec = sql
): Promise<ImportContext> {
  const [entities, accounts, givingTypes] = await Promise.all([
    exec<{ id: string; name: string; functional_currency: string }[]>`
      select id, name, functional_currency from public.entities`,
    exec<{ id: string; code: string; fund_classification: string }[]>`
      select id, code, fund_classification from public.accounts`,
    exec<{ id: string; code: string; default_fund_classification: string }[]>`
      select id, code, default_fund_classification from public.giving_types`,
  ]);

  const entitiesByName = new Map<string, { id: string; currency: string }>();
  const entitiesById = new Map<string, { name: string; currency: string }>();
  for (const e of entities) {
    entitiesByName.set(e.name.toLowerCase(), { id: e.id, currency: e.functional_currency });
    entitiesById.set(e.id, { name: e.name, currency: e.functional_currency });
  }
  const accountsByCode = new Map(
    accounts.map((a) => [a.code, { id: a.id, fund: a.fund_classification }])
  );
  const givingTypesByCode = new Map(
    givingTypes.map((g) => [g.code, { id: g.id, fund: g.default_fund_classification }])
  );

  return {
    actorId,
    accessibleEntityIds,
    isSuperAdmin,
    batchEntityId,
    entitiesByName,
    entitiesById,
    accountsByCode,
    givingTypesByCode,
  };
}

// ---------------------------------------------------------------------------
// Per-row commit with savepoint isolation (one bad row can't abort the batch)
// ---------------------------------------------------------------------------
export async function perRow<T>(
  tx: Exec,
  rows: { rowNumber: number; value: T }[],
  fn: (value: T, tx: Exec) => Promise<string | undefined>
): Promise<CommitResult[]> {
  const results: CommitResult[] = [];
  for (const r of rows) {
    try {
      // @ts-expect-error postgres.js exposes savepoint on the tx handle
      const targetId = await tx.savepoint((sp: Exec) => fn(r.value, sp));
      results.push({ rowNumber: r.rowNumber, targetId });
    } catch (e) {
      results.push({ rowNumber: r.rowNumber, error: (e as Error).message.split("\n")[0] });
    }
  }
  return results;
}
