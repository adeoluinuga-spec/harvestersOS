import "server-only";
import { sql, withActor } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { buildContext, parseSpreadsheet, type RawRow } from "./engine";
import { getImportDef } from "./registry";

export type ActorCtx = {
  actorId: string;
  accessibleEntityIds: string[];
  isSuperAdmin: boolean;
};

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

async function archiveToStorage(
  path: string,
  buffer: ArrayBuffer,
  contentType: string
): Promise<string | null> {
  try {
    const supabase = createClient();
    const { error } = await supabase.storage
      .from("imports")
      .upload(path, new Uint8Array(buffer), { contentType, upsert: true });
    return error ? null : path;
  } catch {
    return null; // archival is best-effort; never fails an import
  }
}

// ---------------------------------------------------------------------------
// Stage + validate (dry run). Returns the batch id and a summary.
// ---------------------------------------------------------------------------
export async function createAndValidateBatch(opts: {
  importType: string;
  entityId: string | null;
  fileName: string;
  contentType: string;
  buffer: ArrayBuffer;
  actor: ActorCtx;
}): Promise<{ batchId: string; total: number; valid: number; invalid: number }> {
  const def = getImportDef(opts.importType);
  if (!def) throw new Error(`Unknown import type: ${opts.importType}`);

  const rawRows: RawRow[] = parseSpreadsheet(opts.buffer);
  if (rawRows.length === 0) throw new Error("The file has no data rows.");

  // Validation is read-only — use the base connection.
  const ctx = await buildContext(
    opts.actor.actorId,
    opts.actor.accessibleEntityIds,
    opts.actor.isSuperAdmin,
    opts.entityId,
    sql
  );

  const staged = rawRows.map((raw, i) => {
    const res = def.validate(raw, ctx);
    return {
      row_number: i + 2, // header is row 1
      raw,
      status: res.ok ? ("valid" as const) : ("invalid" as const),
      errors: res.ok ? null : res.errors,
    };
  });
  const valid = staged.filter((s) => s.status === "valid").length;

  const batchId = await withActor(opts.actor.actorId, async (tx) => {
    const [b] = await tx<{ id: string }[]>`
      insert into public.import_batches
        (import_type, entity_id, status, file_name, total_rows, valid_rows, error_rows, uploaded_by)
      values (${opts.importType}::public.import_type, ${opts.entityId}, 'validated', ${opts.fileName},
              ${staged.length}, ${valid}, ${staged.length - valid}, ${opts.actor.actorId})
      returning id`;
    const rows = staged.map((s) => ({
      batch_id: b.id,
      row_number: s.row_number,
      raw: tx.json(s.raw),
      status: s.status,
      errors: s.errors ? tx.json(s.errors) : null,
    }));
    for (const c of chunk(rows, 500)) {
      await tx`insert into public.import_rows ${tx(c, "batch_id", "row_number", "raw", "status", "errors")}`;
    }
    await tx`update public.import_batches set validated_at = now() where id = ${b.id}`;
    return b.id;
  });

  const path = await archiveToStorage(
    `${batchId}/${opts.fileName}`,
    opts.buffer,
    opts.contentType
  );
  if (path) await sql`update public.import_batches set storage_path = ${path} where id = ${batchId}`;

  return { batchId, total: staged.length, valid, invalid: staged.length - valid };
}

// ---------------------------------------------------------------------------
// Commit the valid rows of a validated batch.
// ---------------------------------------------------------------------------
export async function commitBatch(
  batchId: string,
  actor: ActorCtx
): Promise<{ committed: number; failed: number }> {
  const [batch] = await sql<{ import_type: string; entity_id: string | null; status: string }[]>`
    select import_type, entity_id, status from public.import_batches where id = ${batchId}`;
  if (!batch) throw new Error("Batch not found.");
  if (batch.status === "committed") throw new Error("Batch already committed.");

  const def = getImportDef(batch.import_type);
  if (!def) throw new Error(`Unknown import type: ${batch.import_type}`);

  return withActor(actor.actorId, async (tx) => {
    const ctx = await buildContext(
      actor.actorId,
      actor.accessibleEntityIds,
      actor.isSuperAdmin,
      batch.entity_id,
      tx
    );

    const rows = await tx<{ id: string; row_number: number; raw: RawRow }[]>`
      select id, row_number, raw from public.import_rows
      where batch_id = ${batchId} and status = 'valid' order by row_number`;

    // Re-validate (data may have shifted) and collect committable values.
    const byRowNumber = new Map<number, string>(); // row_number -> import_row id
    const values: { rowNumber: number; value: unknown }[] = [];
    for (const r of rows) {
      byRowNumber.set(r.row_number, r.id);
      const res = def.validate(r.raw, ctx);
      if (res.ok) values.push({ rowNumber: r.row_number, value: res.value });
      else
        await tx`update public.import_rows set status='failed', errors=${tx.json(res.errors)} where id=${r.id}`;
    }

    const results = await def.commit(values, ctx, tx);

    let committed = 0;
    let failed = rows.length - values.length;
    for (const res of results) {
      const id = byRowNumber.get(res.rowNumber);
      if (!id) continue;
      if (res.error) {
        failed++;
        await tx`update public.import_rows set status='failed', errors=${tx.json([{ message: res.error }])} where id=${id}`;
      } else {
        committed++;
        await tx`update public.import_rows
                 set status='committed', target_table=${def.targetTable}, target_record_id=${res.targetId ?? null}
                 where id=${id}`;
      }
    }

    await tx`update public.import_batches
             set committed_rows=${committed}, error_rows=error_rows+${failed - (rows.length - values.length)},
                 status=${failed > 0 ? "partially_committed" : "committed"}::public.import_status,
                 committed_at=now()
             where id=${batchId}`;

    return { committed, failed };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function listBatches(actor: ActorCtx, limit = 50) {
  const scope = actor.isSuperAdmin ? null : actor.accessibleEntityIds;
  return sql`
    select b.id, b.import_type, b.status, b.file_name, b.total_rows, b.valid_rows,
           b.error_rows, b.committed_rows, b.created_at,
           coalesce(e.name, '—') as entity_name, u.email as uploaded_by_email
    from public.import_batches b
    left join public.entities e on e.id = b.entity_id
    left join auth.users u on u.id = b.uploaded_by
    where ${scope ? sql`(b.uploaded_by = ${actor.actorId} or b.entity_id in ${sql(scope.length ? scope : ["00000000-0000-0000-0000-000000000000"])})` : sql`true`}
    order by b.created_at desc limit ${limit}`;
}

export async function getBatch(id: string) {
  const [b] = await sql`select * from public.import_batches where id = ${id}`;
  return b ?? null;
}

export async function getBatchRows(id: string, statusFilter?: string) {
  return sql`
    select row_number, status, raw, errors, target_record_id
    from public.import_rows
    where batch_id = ${id}
      ${statusFilter ? sql`and status = ${statusFilter}::public.import_row_status` : sql``}
    order by row_number limit 500`;
}
