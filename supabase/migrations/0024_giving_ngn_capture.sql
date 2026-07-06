-- ===========================================================================
-- Harvesters Finance OS — 0024 Giving: NGN capture at write + idempotency
--
-- 1. amount_ngn — the NGN-equivalent of every gift is computed ONCE, at
--    write time, at the historical rate (public.fx_rate_at), and stored on
--    the row. Dashboards and analytics stop calling fx_rate_at per row per
--    page view (O(n) subqueries) and read the column instead. Historical
--    truth is preserved: later rate changes never restate amount_ngn.
-- 2. client_key — an idempotency key supplied by the recording form. A
--    double-submitted gift (double click, network retry) lands on the unique
--    index instead of the ledger.
-- ===========================================================================

alter table public.giving_records add column if not exists amount_ngn numeric(18,2);
alter table public.giving_records add column if not exists client_key uuid;

create unique index if not exists uq_giving_client_key
  on public.giving_records(client_key) where client_key is not null;
create index if not exists idx_gr_txn_date on public.giving_records(transaction_date);
create index if not exists idx_gr_attr_date on public.giving_records(attribution_entity_id, transaction_date);
create index if not exists idx_gr_rec_date on public.giving_records(recording_entity_id, transaction_date);

comment on column public.giving_records.amount_ngn is
  'NGN equivalent captured at write time at the historical rate. Never restated.';
comment on column public.giving_records.client_key is
  'Client-generated idempotency key: a duplicate submit is rejected by the unique index instead of double-recording.';

create or replace function app_private.tg_giving_capture_ngn()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.amount_ngn := round(
    new.amount * public.fx_rate_at(new.currency::text, 'NGN', new.transaction_date), 2);
  return new;
end $$;

drop trigger if exists trg_giving_capture_ngn on public.giving_records;
create trigger trg_giving_capture_ngn
  before insert or update of amount, currency, transaction_date on public.giving_records
  for each row execute function app_private.tg_giving_capture_ngn();

-- One-time backfill (audit stays quiet: a migration is not a user action).
alter table public.giving_records disable trigger trg_audit;
update public.giving_records
   set amount_ngn = round(amount * public.fx_rate_at(currency::text, 'NGN', transaction_date), 2)
 where amount_ngn is null;
alter table public.giving_records enable trigger trg_audit;
