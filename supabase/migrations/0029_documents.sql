-- ===========================================================================
-- Harvesters Finance OS — 0029 Document attachments
--
-- An expense without an invoice is un-auditable. This adds a polymorphic
-- document registry backed by a PRIVATE storage bucket, so any financial
-- record (requisition, vendor, journal entry, transfer, investment) can carry
-- its supporting paperwork. Files are immutable once attached; removal is a
-- soft-delete (the audit trail keeps who attached/removed what, when).
-- ===========================================================================

create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in
    ('requisition','vendor','journal_entry','cross_border_transfer',
     'investment','giver','fixed_asset','other')),
  subject_id   uuid not null,
  entity_id    uuid references public.entities(id) on delete set null,
  file_name    text not null,
  storage_path text not null,
  content_type text,
  size_bytes   bigint,
  note         text,
  uploaded_by  uuid references auth.users(id),
  uploaded_at  timestamptz not null default now(),
  is_deleted   boolean not null default false
);
create index if not exists idx_documents_subject on public.documents(subject_type, subject_id);
create index if not exists idx_documents_entity on public.documents(entity_id);

comment on table public.documents is
  'Supporting paperwork (invoices, quotes, bank letters) attached to financial records. Files live in the private "documents" bucket; rows are soft-deleted, never erased.';

-- Private bucket + storage policies (same pattern as the imports archive).
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists documents_bucket_insert on storage.objects;
create policy documents_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents');

drop policy if exists documents_bucket_select on storage.objects;
create policy documents_bucket_select on storage.objects for select to authenticated
  using (bucket_id = 'documents');

-- RLS + grants
alter table public.documents enable row level security;
revoke all on public.documents from anon, authenticated;
grant select on public.documents to authenticated;
grant all on public.documents to service_role;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (entity_id is null or public.user_can_access_entity(entity_id));

drop policy if exists hfos_app_rw on public.documents;
create policy hfos_app_rw on public.documents for all to hfos_app
  using (true) with check (true);

drop trigger if exists trg_audit on public.documents;
create trigger trg_audit after insert or update or delete on public.documents
  for each row execute function app_private.tg_audit();
