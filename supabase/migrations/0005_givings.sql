-- ===========================================================================
-- Harvesters Finance OS — 0005 Givings
-- Unique giver identity (with fuzzy-match dedupe review), giving types mapped
-- to the chart of accounts, giving records that POST TO THE PHASE 1 LEDGER
-- (no parallel balances), pledges/vows as receivables with an AR-style aging
-- view, and giving-statement data.
-- ===========================================================================

create extension if not exists pg_trgm with schema extensions;

-- --- Enums -----------------------------------------------------------------
do $$ begin create type public.identifier_type as enum ('phone','email','member_id');
exception when duplicate_object then null; end $$;

do $$ begin create type public.giving_channel as enum
  ('cash','pos','bank_transfer','online_paystack','ussd','standing_order');
exception when duplicate_object then null; end $$;

do $$ begin create type public.reconciliation_status as enum ('unreconciled','matched','disputed');
exception when duplicate_object then null; end $$;

do $$ begin create type public.pledge_type as enum ('building_fund','missions','vow');
exception when duplicate_object then null; end $$;

do $$ begin create type public.pledge_status as enum ('active','fulfilled','lapsed');
exception when duplicate_object then null; end $$;

do $$ begin create type public.merge_status as enum ('pending','merged','dismissed');
exception when duplicate_object then null; end $$;

-- --- Unique giver identity -------------------------------------------------
create table if not exists public.givers (
  id                uuid primary key default gen_random_uuid(),
  full_name         text not null,
  phone             text,
  email             text,
  date_of_birth     date,
  primary_entity_id uuid references public.entities(id) on delete set null,
  is_active         boolean not null default true,   -- false once merged away
  created_at        timestamptz not null default now()
);
create index if not exists idx_givers_name_trgm on public.givers using gin (full_name extensions.gin_trgm_ops);

-- One person may be recorded differently at different campuses; all identifiers
-- resolve to a single giver_id. Values are stored normalized.
create table if not exists public.giver_identifiers (
  id                    uuid primary key default gen_random_uuid(),
  giver_id              uuid not null references public.givers(id) on delete cascade,
  identifier_type       public.identifier_type not null,
  identifier_value      text not null,               -- normalized (digits / lowercased)
  entity_id_recorded_at uuid references public.entities(id) on delete set null,
  created_at            timestamptz not null default now(),
  unique (giver_id, identifier_type, identifier_value)
);
create index if not exists idx_giver_ident_lookup
  on public.giver_identifiers(identifier_type, identifier_value);

-- Potential-duplicate review queue (fuzzy, non-exact matches).
create table if not exists public.giver_merge_candidates (
  id          uuid primary key default gen_random_uuid(),
  giver_id_a  uuid not null references public.givers(id) on delete cascade,  -- newly created
  giver_id_b  uuid not null references public.givers(id) on delete cascade,  -- existing near-match
  score       real not null,
  reason      text,
  status      public.merge_status not null default 'pending',
  detected_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  constraint mc_distinct check (giver_id_a <> giver_id_b)
);
-- At most one pending candidate per unordered pair.
create unique index if not exists mc_pair_pending on public.giver_merge_candidates
  (least(giver_id_a, giver_id_b), greatest(giver_id_a, giver_id_b)) where status = 'pending';

-- --- Giving types (behaviour, not just labels) -----------------------------
create table if not exists public.giving_types (
  id                          uuid primary key default gen_random_uuid(),
  code                        text unique not null,
  name                        text not null,
  default_fund_classification public.fund_classification not null,
  default_account_id          uuid not null references public.accounts(id),
  is_active                   boolean not null default true,
  sort_order                  int not null default 0
);

-- --- Giving records (each posts to the ledger) -----------------------------
create table if not exists public.giving_records (
  id                    uuid primary key default gen_random_uuid(),
  giver_id              uuid references public.givers(id) on delete restrict, -- null = anonymous
  entity_id             uuid not null references public.entities(id) on delete restrict,
  giving_type_id        uuid not null references public.giving_types(id),
  amount                numeric(18,2) not null check (amount > 0),
  currency              char(3) not null,
  channel               public.giving_channel not null,
  transaction_date      date not null,
  recorded_by           uuid references auth.users(id),
  reconciliation_status public.reconciliation_status not null default 'unreconciled',
  journal_entry_id      uuid references public.journal_entries(id),           -- set on post
  note                  text,
  created_at            timestamptz not null default now(),
  constraint gr_currency_len check (char_length(currency) = 3)
);
create index if not exists idx_gr_giver on public.giving_records(giver_id);
create index if not exists idx_gr_entity on public.giving_records(entity_id);
create index if not exists idx_gr_date on public.giving_records(transaction_date);
create index if not exists idx_gr_type on public.giving_records(giving_type_id);

-- --- Pledges / vows (receivables) ------------------------------------------
create table if not exists public.pledges (
  id                      uuid primary key default gen_random_uuid(),
  giver_id                uuid not null references public.givers(id) on delete restrict,
  entity_id               uuid not null references public.entities(id) on delete restrict,
  pledge_type             public.pledge_type not null,
  total_pledged_amount    numeric(18,2) not null check (total_pledged_amount > 0),
  currency                char(3) not null,
  start_date              date not null default current_date,
  target_fulfillment_date date,
  status                  public.pledge_status not null default 'active',
  created_at              timestamptz not null default now()
);
create index if not exists idx_pledges_entity on public.pledges(entity_id);
create index if not exists idx_pledges_giver on public.pledges(giver_id);

create table if not exists public.pledge_fulfillments (
  id               uuid primary key default gen_random_uuid(),
  pledge_id        uuid not null references public.pledges(id) on delete cascade,
  giving_record_id uuid not null references public.giving_records(id) on delete restrict,
  amount           numeric(18,2) not null check (amount > 0),
  created_at       timestamptz not null default now(),
  unique (giving_record_id)   -- a gift fulfils at most one pledge
);
create index if not exists idx_pf_pledge on public.pledge_fulfillments(pledge_id);

-- --- Extra income accounts for the full giving-type set --------------------
insert into public.accounts (code, name, account_type, fund_classification) values
  ('4011', 'Event Offerings',  'income', 'unrestricted'),
  ('4021', 'Missions Giving',  'income', 'temporarily_restricted'),
  ('4031', 'First Fruit',      'income', 'unrestricted'),
  ('4032', 'Vows',             'income', 'unrestricted')
on conflict (code) do nothing;

-- --- Seed giving types with fund + account mapping -------------------------
insert into public.giving_types (code, name, default_fund_classification, default_account_id, sort_order)
select v.code, v.name, v.fc::public.fund_classification, a.id, v.ord
from (values
  ('tithe',          'Tithe',           'unrestricted',            '4000', 1),
  ('offering',       'Offering',        'unrestricted',            '4010', 2),
  ('seed',           'Seed',            'unrestricted',            '4030', 3),
  ('first_fruit',    'First Fruit',     'unrestricted',            '4031', 4),
  ('building_fund',  'Building Fund',   'temporarily_restricted',  '4020', 5),
  ('missions_pledge','Missions Pledge', 'temporarily_restricted',  '4021', 6),
  ('vow',            'Vow',             'unrestricted',            '4032', 7),
  ('partnership',    'Partnership',     'temporarily_restricted',  '4040', 8),
  ('event_offering', 'Event Offering',  'unrestricted',            '4011', 9)
) as v(code, name, fc, acct, ord)
join public.accounts a on a.code = v.acct
on conflict (code) do nothing;
