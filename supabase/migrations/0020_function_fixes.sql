-- ===========================================================================
-- Harvesters Finance OS — 0020 Function fixes (surfaced by real-usage simulation)
-- Two latent runtime bugs that only fire on live code paths:
--   1. create_vendor(): calls similarity() but runs with search_path='' so
--      pg_trgm can't resolve -> "function similarity(text,text) does not exist".
--      Fix: qualify as extensions.similarity.
--   2. detect_lapsed_partners(): the OUT parameter commitment_id shadows the
--      table column in the INSERT ... ON CONFLICT clause -> "column reference
--      commitment_id is ambiguous". Fix: #variable_conflict use_column.
-- ===========================================================================

create or replace function public.create_vendor(
  p_name text, p_bank_account_number text, p_tax_id text default null::text,
  p_is_related_party boolean default false
) returns uuid language plpgsql security definer set search_path to '' as $function$
declare v_id uuid; v_last4 text;
begin
  v_last4 := right(regexp_replace(coalesce(p_bank_account_number, ''), '\D', '', 'g'), 4);
  insert into public.vendors (name, bank_account_number_encrypted, bank_account_number_last4, tax_id, is_related_party)
  values (p_name, public.encrypt_account_number(p_bank_account_number), v_last4, p_tax_id, p_is_related_party)
  returning id into v_id;

  insert into public.vendor_duplicate_flags (vendor_id, possible_duplicate_vendor_id, score, reason)
  select v_id, v.id,
         greatest(extensions.similarity(lower(p_name), lower(v.name)),
                  case when v.bank_account_number_last4 = v_last4 then 0.85 else 0 end),
         concat_ws(' + ',
           case when extensions.similarity(lower(p_name), lower(v.name)) >= 0.55 then 'similar name' end,
           case when v.bank_account_number_last4 = v_last4 then 'same bank account last 4' end)
  from public.vendors v
  where v.id <> v_id
    and (extensions.similarity(lower(p_name), lower(v.name)) >= 0.55 or v.bank_account_number_last4 = v_last4);
  return v_id;
end $function$;

create or replace function public.detect_lapsed_partners(p_as_of date default current_date)
returns table(partner_id uuid, commitment_id uuid, missed_periods integer)
language plpgsql security definer set search_path to '' as $function$
#variable_conflict use_column
declare
  r record;
  m0 date := date_trunc('month', p_as_of)::date;
  m1 date := (date_trunc('month', p_as_of) - interval '1 month')::date;
begin
  for r in
    select pc.id as commitment_id, pc.partner_id
    from public.partnership_commitments pc
    join public.partners p on p.id = pc.partner_id
    where pc.is_active
      and p.status <> 'paused'
      and pc.start_month <= m1
      and not exists (select 1 from public.partnership_fulfillments pf
                      where pf.commitment_id = pc.id and pf.fulfilled_month = m0)
      and not exists (select 1 from public.partnership_fulfillments pf
                      where pf.commitment_id = pc.id and pf.fulfilled_month = m1)
  loop
    insert into public.partnership_lapse_flags
      (partner_id, commitment_id, first_missed_month, missed_periods)
    values (r.partner_id, r.commitment_id, m1, 2)
    on conflict (commitment_id) where status = 'open' do update
      set missed_periods = greatest(public.partnership_lapse_flags.missed_periods, 2),
          detected_at = now();

    update public.partners set status = 'lapsed' where id = r.partner_id;
    partner_id := r.partner_id;
    commitment_id := r.commitment_id;
    missed_periods := 2;
    return next;
  end loop;
end $function$;

revoke all on function public.create_vendor(text, text, text, boolean) from anon;
