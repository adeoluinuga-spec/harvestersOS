import "server-only";
import { sql, type Exec } from "./db";
import { createClient } from "./supabase/server";

/**
 * Document attachments (invoices, quotes, bank letters) for financial records.
 * Files live in the private `documents` storage bucket; metadata rows in
 * public.documents. Uploads/downloads go through the user's authenticated
 * Supabase session (bucket policies), metadata through the app connection.
 */

export type DocumentRow = {
  id: string;
  subject_type: string;
  subject_id: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  note: string | null;
  uploaded_by_email: string | null;
  uploaded_at: string;
  storage_path: string;
};

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per file
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/csv",
]);

export async function getDocuments(
  subjectType: string,
  subjectId: string
): Promise<DocumentRow[]> {
  return sql<DocumentRow[]>`
    select d.id, d.subject_type, d.subject_id, d.file_name, d.content_type,
           d.size_bytes, d.note, u.email as uploaded_by_email,
           d.uploaded_at::text, d.storage_path
    from public.documents d
    left join public.app_users u on u.id = d.uploaded_by
    where d.subject_type = ${subjectType} and d.subject_id = ${subjectId}
      and not d.is_deleted
    order by d.uploaded_at desc`;
}

/** Attachment counts for a set of subjects (badges on list pages). */
export async function getDocumentCounts(
  subjectType: string,
  subjectIds: string[]
): Promise<Map<string, number>> {
  if (subjectIds.length === 0) return new Map();
  const rows = await sql<{ subject_id: string; n: number }[]>`
    select subject_id, count(*)::int n from public.documents
    where subject_type = ${subjectType} and subject_id in ${sql(subjectIds)}
      and not is_deleted
    group by subject_id`;
  return new Map(rows.map((r) => [r.subject_id, r.n]));
}

/**
 * Upload a file to the private bucket (via the caller's session) and record
 * it. Returns the document id. Rejects oversized or unexpected file types.
 */
export async function attachDocument(
  d: {
    subjectType: string;
    subjectId: string;
    entityId: string | null;
    file: File;
    note?: string | null;
    actorId: string;
  },
  exec: Exec = sql
): Promise<string> {
  if (d.file.size === 0) throw new Error("The selected file is empty.");
  if (d.file.size > MAX_BYTES) throw new Error("File is larger than 15 MB.");
  const type = d.file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.has(type))
    throw new Error("Only PDF, image, Word, Excel and CSV files are accepted.");

  const safeName = d.file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 140);
  const path = `${d.subjectType}/${d.subjectId}/${Date.now()}-${safeName}`;

  const supabase = createClient();
  const buffer = await d.file.arrayBuffer();
  const { error } = await supabase.storage
    .from("documents")
    .upload(path, new Uint8Array(buffer), { contentType: type, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const [row] = await exec<{ id: string }[]>`
    insert into public.documents
      (subject_type, subject_id, entity_id, file_name, storage_path,
       content_type, size_bytes, note, uploaded_by)
    values (${d.subjectType}, ${d.subjectId}, ${d.entityId}, ${d.file.name},
            ${path}, ${type}, ${d.file.size}, ${d.note ?? null}, ${d.actorId})
    returning id`;
  return row.id;
}

/** Soft-delete (the audit log keeps the full history). */
export async function removeDocument(id: string, exec: Exec = sql): Promise<void> {
  await exec`update public.documents set is_deleted = true where id = ${id}`;
}

/** A short-lived signed download URL, or null if the file/scope is invalid. */
export async function getSignedDocumentUrl(
  id: string,
  accessibleEntityIds: string[] | "all"
): Promise<{ url: string; fileName: string } | null> {
  const [doc] = await sql<{ storage_path: string; file_name: string; entity_id: string | null }[]>`
    select storage_path, file_name, entity_id from public.documents
    where id = ${id} and not is_deleted`;
  if (!doc) return null;
  if (
    accessibleEntityIds !== "all" &&
    doc.entity_id !== null &&
    !accessibleEntityIds.includes(doc.entity_id)
  )
    return null;

  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.storage_path, 300);
  if (error || !data?.signedUrl) return null;
  return { url: data.signedUrl, fileName: doc.file_name };
}
