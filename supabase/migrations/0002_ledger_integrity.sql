-- ===========================================================================
-- Harvesters Finance OS — 0002 Ledger integrity + encryption
-- Enforces double-entry balance and append-only immutability at the DATABASE
-- level (triggers fire for every writer, including privileged ones), plus
-- at-rest encryption of bank account numbers via Vault + pgcrypto.
-- ===========================================================================

create schema if not exists app_private;

-- ---------------------------------------------------------------------------
-- Bank account number encryption
-- ---------------------------------------------------------------------------
-- One-time symmetric key, generated and stored in Supabase Vault.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'bank_account_enc_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'bank_account_enc_key',
      'Symmetric key for encrypting bank account numbers (Harvesters Finance OS)'
    );
  end if;
end $$;

create or replace function app_private.bank_enc_key()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'bank_account_enc_key' limit 1;
$$;

create or replace function public.encrypt_account_number(p_plain text)
returns bytea language sql volatile security definer set search_path = '' as $$
  select extensions.pgp_sym_encrypt(p_plain, app_private.bank_enc_key());
$$;

create or replace function public.decrypt_account_number(p_cipher bytea)
returns text language sql stable security definer set search_path = '' as $$
  select extensions.pgp_sym_decrypt(p_cipher, app_private.bank_enc_key());
$$;

-- Convenience: encrypt + store last-4 in one call.
create or replace function public.create_bank_account(
  p_entity_id uuid, p_bank_name text, p_account_number text,
  p_account_purpose public.account_purpose, p_currency text
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.bank_accounts
    (entity_id, bank_name, account_number_encrypted, account_number_last4, account_purpose, currency)
  values
    (p_entity_id, p_bank_name,
     public.encrypt_account_number(p_account_number),
     right(regexp_replace(p_account_number, '\D', '', 'g'), 4),
     p_account_purpose, upper(p_currency))
  returning id into v_id;
  return v_id;
end $$;

-- These handle secrets/PII — keep them off the public API surface.
revoke all on function app_private.bank_enc_key() from public, anon, authenticated;
revoke all on function public.encrypt_account_number(text) from public, anon, authenticated;
revoke all on function public.decrypt_account_number(bytea) from public, anon, authenticated;
revoke all on function public.create_bank_account(uuid,text,text,public.account_purpose,text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Double-entry balance assertion (in presentation currency)
-- ---------------------------------------------------------------------------
create or replace function app_private.assert_entry_balanced(p_entry_id uuid)
returns void language plpgsql stable set search_path = '' as $$
declare
  v_lines   int;
  v_debits  numeric(20,2);
  v_credits numeric(20,2);
begin
  select count(*),
         coalesce(sum(round(debit_amount  * fx_rate_to_presentation_currency, 2)), 0),
         coalesce(sum(round(credit_amount * fx_rate_to_presentation_currency, 2)), 0)
    into v_lines, v_debits, v_credits
  from public.journal_entry_lines
  where journal_entry_id = p_entry_id;

  if v_lines < 2 then
    raise exception 'Journal entry % must have at least two lines to post', p_entry_id
      using errcode = 'check_violation';
  end if;
  if v_debits = 0 then
    raise exception 'Journal entry % has zero value', p_entry_id
      using errcode = 'check_violation';
  end if;
  if v_debits <> v_credits then
    raise exception 'Journal entry % is unbalanced: debits % <> credits %', p_entry_id, v_debits, v_credits
      using errcode = 'check_violation';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Immutability guard: journal_entries
--   draft      -> editable; may transition to posted (balance validated)
--   posted     -> immutable, EXCEPT the single transition posted -> reversed
--   reversed   -> immutable
--   inserts as 'posted' are rejected (post via update once lines exist)
--   only draft entries may be deleted
-- ---------------------------------------------------------------------------
create or replace function app_private.tg_journal_entries_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'posted' then
      raise exception 'Insert journal entries as draft, then post (entry cannot be created posted)'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Posted/reversed journal entry % is immutable and cannot be deleted', old.id
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.status = 'draft' then
    if new.status = 'posted' then
      perform app_private.assert_entry_balanced(new.id);
      new.posted_at := coalesce(new.posted_at, now());
    elsif new.status = 'reversed' then
      raise exception 'A draft cannot move directly to reversed' using errcode = 'check_violation';
    end if;
    return new;

  elsif old.status = 'posted' then
    -- The only permitted mutation of a posted entry is marking it reversed.
    if new.status = 'reversed'
       and new.entity_id            =            old.entity_id
       and new.transaction_date     =            old.transaction_date
       and new.description          is not distinct from old.description
       and new.source_module        =            old.source_module
       and new.created_by           is not distinct from old.created_by
       and new.reversal_of_entry_id is not distinct from old.reversal_of_entry_id
       and new.posted_at            is not distinct from old.posted_at then
      return new;
    end if;
    raise exception 'Posted journal entry % is immutable (only posted -> reversed is allowed)', old.id
      using errcode = 'check_violation';

  else -- reversed
    raise exception 'Reversed journal entry % is immutable', old.id
      using errcode = 'check_violation';
  end if;
end $$;

drop trigger if exists trg_journal_entries_guard on public.journal_entries;
create trigger trg_journal_entries_guard
  before insert or update or delete on public.journal_entries
  for each row execute function app_private.tg_journal_entries_guard();

-- ---------------------------------------------------------------------------
-- Immutability guard: journal_entry_lines
--   lines may only be inserted/updated/deleted while the parent entry is draft.
--   once posted, lines are frozen forever — corrections are reversing entries.
-- ---------------------------------------------------------------------------
create or replace function app_private.tg_journal_entry_lines_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_status public.journal_entry_status;
begin
  if tg_op = 'INSERT' then
    select status into v_status from public.journal_entries where id = new.journal_entry_id;
    if v_status is null then
      raise exception 'Parent journal entry % not found', new.journal_entry_id
        using errcode = 'foreign_key_violation';
    end if;
    if v_status <> 'draft' then
      raise exception 'Cannot add lines to a % entry; the ledger is append-only (use a reversing entry)', v_status
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select status into v_status from public.journal_entries
  where id = coalesce(old.journal_entry_id, new.journal_entry_id);
  if v_status is distinct from 'draft' then
    raise exception 'Journal entry lines are immutable once posted (attempted %). Use a reversing entry.', tg_op
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists trg_journal_entry_lines_guard on public.journal_entry_lines;
create trigger trg_journal_entry_lines_guard
  before insert or update or delete on public.journal_entry_lines
  for each row execute function app_private.tg_journal_entry_lines_guard();

-- ---------------------------------------------------------------------------
-- Ledger API: post + reverse (the sanctioned write paths)
-- ---------------------------------------------------------------------------
create or replace function public.post_journal_entry(p_entry_id uuid, p_approved_by uuid default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.journal_entries
     set status = 'posted', approved_by = coalesce(p_approved_by, approved_by)
   where id = p_entry_id and status = 'draft';
  if not found then
    raise exception 'Entry % not found or not in draft state', p_entry_id using errcode = 'check_violation';
  end if;
end $$;

create or replace function public.reverse_journal_entry(
  p_entry_id uuid, p_reason text default null, p_date date default null, p_actor uuid default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_src public.journal_entries; v_new_id uuid;
begin
  select * into v_src from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'Entry % not found', p_entry_id using errcode = 'check_violation';
  end if;
  if v_src.status <> 'posted' then
    raise exception 'Only posted entries can be reversed (entry % is %)', p_entry_id, v_src.status
      using errcode = 'check_violation';
  end if;

  insert into public.journal_entries
    (entity_id, transaction_date, description, source_module, created_by, reversal_of_entry_id, status)
  values
    (v_src.entity_id, coalesce(p_date, current_date),
     coalesce(p_reason, 'Reversal of entry ' || v_src.id::text),
     'reversal', p_actor, v_src.id, 'draft')
  returning id into v_new_id;

  -- Flip debits and credits.
  insert into public.journal_entry_lines
    (journal_entry_id, account_id, entity_id, debit_amount, credit_amount,
     fund_classification, currency, fx_rate_to_presentation_currency)
  select v_new_id, account_id, entity_id, credit_amount, debit_amount,
         fund_classification, currency, fx_rate_to_presentation_currency
  from public.journal_entry_lines where journal_entry_id = p_entry_id;

  update public.journal_entries set status = 'posted', approved_by = p_actor where id = v_new_id;
  update public.journal_entries set status = 'reversed' where id = p_entry_id;
  return v_new_id;
end $$;

revoke all on function public.post_journal_entry(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reverse_journal_entry(uuid, text, date, uuid) from public, anon, authenticated;
