-- ===========================================================================
-- Harvesters Finance OS — 0001 Schema
-- Entity hierarchy, global chart of accounts, immutable double-entry ledger,
-- and multi-bank account model. Structure only; integrity logic is in 0002.
-- ===========================================================================

-- --- Enums (idempotent) ----------------------------------------------------
do $$ begin create type public.entity_type as enum
  ('group','sub_group','campus','ministry_expression','event');
exception when duplicate_object then null; end $$;

do $$ begin create type public.legal_status as enum
  ('incorporated_trustee','separate_foreign_entity','unincorporated_unit');
exception when duplicate_object then null; end $$;

do $$ begin create type public.account_type as enum
  ('asset','liability','equity','income','expense');
exception when duplicate_object then null; end $$;

do $$ begin create type public.fund_classification as enum
  ('unrestricted','temporarily_restricted','permanently_restricted','board_designated');
exception when duplicate_object then null; end $$;

-- Extensible: new source modules can be appended with ALTER TYPE ... ADD VALUE.
do $$ begin create type public.source_module as enum
  ('giving','expense','payroll','transfer','adjustment','opening_balance','reversal');
exception when duplicate_object then null; end $$;

do $$ begin create type public.journal_entry_status as enum
  ('draft','posted','reversed');
exception when duplicate_object then null; end $$;

-- Extensible: append new purposes with ALTER TYPE ... ADD VALUE.
do $$ begin create type public.account_purpose as enum
  ('tithes_offerings','building_fund','payroll','welfare','operations','investments','other');
exception when duplicate_object then null; end $$;

-- --- Entity hierarchy (polymorphic, arbitrary depth) -----------------------
create table if not exists public.entities (
  id                  uuid primary key default gen_random_uuid(),
  type                public.entity_type not null,
  parent_entity_id    uuid references public.entities(id) on delete restrict,
  name                text not null,
  country             text,                         -- ISO 3166 alpha-2 (e.g. NG, GB, US)
  functional_currency char(3) not null,             -- ISO 4217 (e.g. NGN, GBP, USD)
  legal_status        public.legal_status,
  is_active           boolean not null default true,
  start_date          date,                          -- events only
  end_date            date,                          -- events only
  created_at          timestamptz not null default now(),
  -- Only a top-level Group may be parentless; every other node must have a parent.
  constraint entities_parent_required check (type = 'group' or parent_entity_id is not null),
  -- Events are temporary and must carry a valid date range.
  constraint entities_event_dates check (
    type <> 'event'
    or (start_date is not null and end_date is not null and end_date >= start_date)
  ),
  constraint entities_currency_len check (char_length(functional_currency) = 3),
  constraint entities_no_self_parent check (parent_entity_id is null or parent_entity_id <> id)
);
create index if not exists idx_entities_parent on public.entities(parent_entity_id);
create index if not exists idx_entities_type on public.entities(type);
create index if not exists idx_entities_active on public.entities(is_active);

comment on table public.entities is
  'Polymorphic org hierarchy: Group -> Sub-Group -> Campus (arbitrary depth), plus parallel Ministry Expression and temporary Event nodes.';

-- --- Chart of accounts (GLOBAL structure, shared across all entities) -------
create table if not exists public.accounts (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  name                text not null,
  account_type        public.account_type not null,
  fund_classification public.fund_classification not null default 'unrestricted',
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);
create index if not exists idx_accounts_type on public.accounts(account_type);

comment on table public.accounts is
  'Global chart of accounts. The structure is shared; every ledger line ties an account to a specific entity, enabling both per-entity and consolidated reporting from one data set.';

-- --- The ledger: journal entries (immutable, append-only) -------------------
create table if not exists public.journal_entries (
  id                   uuid primary key default gen_random_uuid(),
  entity_id            uuid not null references public.entities(id) on delete restrict,
  transaction_date     date not null,
  description          text,
  source_module        public.source_module not null,
  created_by           uuid references auth.users(id),
  approved_by          uuid references auth.users(id),
  status               public.journal_entry_status not null default 'draft',
  reversal_of_entry_id uuid references public.journal_entries(id) on delete restrict,
  created_at           timestamptz not null default now(),
  posted_at            timestamptz,
  constraint je_reversal_distinct check (reversal_of_entry_id is null or reversal_of_entry_id <> id)
);
create index if not exists idx_je_entity on public.journal_entries(entity_id);
create index if not exists idx_je_status on public.journal_entries(status);
create index if not exists idx_je_txn_date on public.journal_entries(transaction_date);
create index if not exists idx_je_reversal on public.journal_entries(reversal_of_entry_id);

-- --- The ledger: journal entry lines (double-entry) ------------------------
create table if not exists public.journal_entry_lines (
  id                                uuid primary key default gen_random_uuid(),
  journal_entry_id                  uuid not null references public.journal_entries(id) on delete restrict,
  account_id                        uuid not null references public.accounts(id) on delete restrict,
  entity_id                         uuid not null references public.entities(id) on delete restrict,
  debit_amount                      numeric(18,2) not null default 0,
  credit_amount                     numeric(18,2) not null default 0,
  fund_classification               public.fund_classification not null,
  currency                          char(3) not null,
  fx_rate_to_presentation_currency  numeric(20,10) not null default 1,
  created_at                        timestamptz not null default now(),
  constraint jel_amounts_nonneg check (debit_amount >= 0 and credit_amount >= 0),
  -- A line is exactly one side of the entry: a debit XOR a credit, never both/neither.
  constraint jel_one_side check (
    (debit_amount > 0 and credit_amount = 0) or (credit_amount > 0 and debit_amount = 0)
  ),
  constraint jel_fx_positive check (fx_rate_to_presentation_currency > 0),
  constraint jel_currency_len check (char_length(currency) = 3)
);
create index if not exists idx_jel_entry on public.journal_entry_lines(journal_entry_id);
create index if not exists idx_jel_account on public.journal_entry_lines(account_id);
create index if not exists idx_jel_entity on public.journal_entry_lines(entity_id);

-- --- Multi-bank account model ----------------------------------------------
create table if not exists public.bank_accounts (
  id                       uuid primary key default gen_random_uuid(),
  entity_id                uuid not null references public.entities(id) on delete restrict,
  bank_name                text not null,
  account_number_encrypted bytea not null,           -- pgp_sym_encrypt, key in Vault
  account_number_last4     text,                      -- display only
  account_purpose          public.account_purpose not null default 'other',
  currency                 char(3) not null,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  constraint bank_currency_len check (char_length(currency) = 3)
);
create index if not exists idx_bank_entity on public.bank_accounts(entity_id);

comment on column public.bank_accounts.account_number_encrypted is
  'Account number encrypted at rest via pgp_sym_encrypt; symmetric key stored in Supabase Vault. Decrypt only via restricted SECURITY DEFINER function.';
