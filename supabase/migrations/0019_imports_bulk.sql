-- ===========================================================================
-- Harvesters Finance OS — 0019 Spreadsheet imports + bulk send channels
-- A single reusable import pipeline (stage -> validate -> commit) for every
-- bulk-loadable dataset, plus an email outbox for bulk send. Ledger-affecting
-- imports post real journal entries; nothing writes a parallel balance.
-- ===========================================================================

-- --- Enums -----------------------------------------------------------------
do $$ begin create type public.import_type as enum (
  'givers','giving_records','opening_balances','bank_statement','chart_of_accounts',
  'budget_lines','vendors','staff','pledges','partners','partnership_commitments',
  'fx_rates','investments','entities','restricted_funds'
); exception when duplicate_object then null; end $$;

do $$ begin create type public.import_status as enum (
  'uploaded','validating','validated','committing','committed','failed','partially_committed'
); exception when duplicate_object then null; end $$;

do $$ begin create type public.import_row_status as enum (
  'pending','valid','invalid','committed','skipped','failed'
); exception when duplicate_object then null; end $$;

do $$ begin create type public.email_status as enum (
  'queued','sending','sent','failed','cancelled'
); exception when duplicate_object then null; end $$;

-- --- Import batches ---------------------------------------------------------
create table if not exists public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  import_type    public.import_type not null,
  entity_id      uuid references public.entities(id) on delete set null,  -- context/scope
  status         public.import_status not null default 'uploaded',
  file_name      text,
  storage_path   text,                       -- Supabase Storage object path (best-effort archive)
  source_hash    text,                       -- dedupe re-uploads of the same file
  total_rows     int not null default 0,
  valid_rows     int not null default 0,
  error_rows     int not null default 0,
  committed_rows int not null default 0,
  uploaded_by    uuid references auth.users(id),
  notes          text,
  created_at     timestamptz not null default now(),
  validated_at   timestamptz,
  committed_at   timestamptz
);
create index if not exists idx_import_batches_type on public.import_batches(import_type);
create index if not exists idx_import_batches_entity on public.import_batches(entity_id);
create index if not exists idx_import_batches_uploader on public.import_batches(uploaded_by);

-- --- Import rows (staging) --------------------------------------------------
create table if not exists public.import_rows (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references public.import_batches(id) on delete cascade,
  row_number       int not null,
  raw              jsonb not null,
  status           public.import_row_status not null default 'pending',
  errors           jsonb,
  target_table     text,
  target_record_id text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_import_rows_batch on public.import_rows(batch_id);
create index if not exists idx_import_rows_status on public.import_rows(batch_id, status);

-- --- Email outbox (bulk send) ----------------------------------------------
create table if not exists public.email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  to_email            text not null,
  to_name             text,
  subject             text not null,
  body_html           text,
  body_text           text,
  kind                text,                  -- giving_statement | receipt | notice | ...
  context             jsonb,                 -- e.g. { giver_id, year }
  entity_id           uuid references public.entities(id) on delete set null,
  status              public.email_status not null default 'queued',
  attempts            int not null default 0,
  provider_message_id text,
  error               text,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index if not exists idx_outbox_status on public.email_outbox(status);
create index if not exists idx_outbox_entity on public.email_outbox(entity_id);

-- --- Opening Balance Equity (plug account for opening-balance imports) ------
insert into public.accounts (code, name, account_type, fund_classification) values
  ('3200', 'Opening Balance Equity', 'equity', 'unrestricted')
on conflict (code) do nothing;

-- --- Audit + RLS -----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['import_batches','import_rows','email_outbox'] loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format(
      'create trigger trg_audit after insert or update or delete on public.%I
         for each row execute function app_private.tg_audit()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

drop policy if exists import_batches_select on public.import_batches;
create policy import_batches_select on public.import_batches for select to authenticated
  using (uploaded_by = auth.uid() or public.is_super_admin()
         or (entity_id is not null and public.user_can_access_entity(entity_id)));

drop policy if exists import_rows_select on public.import_rows;
create policy import_rows_select on public.import_rows for select to authenticated
  using (exists (select 1 from public.import_batches b where b.id = batch_id
                 and (b.uploaded_by = auth.uid() or public.is_super_admin()
                      or (b.entity_id is not null and public.user_can_access_entity(b.entity_id)))));

drop policy if exists email_outbox_select on public.email_outbox;
create policy email_outbox_select on public.email_outbox for select to authenticated
  using (created_by = auth.uid() or public.is_super_admin()
         or (entity_id is not null and public.user_can_access_entity(entity_id)));

-- --- Private Storage bucket for raw uploads (best-effort archive) -----------
insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

drop policy if exists imports_bucket_insert on storage.objects;
create policy imports_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'imports');

drop policy if exists imports_bucket_select on storage.objects;
create policy imports_bucket_select on storage.objects for select to authenticated
  using (bucket_id = 'imports');
