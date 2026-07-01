-- ===========================================================================
-- Harvesters Finance OS — 0006 Givings logic
-- Fuzzy giver matching, ledger posting, giver merge, pledge aging, audit, RLS.
-- ===========================================================================

-- --- Normalisation helpers -------------------------------------------------
create or replace function public.normalize_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '');
$$;

create or replace function public.normalize_email(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(lower(trim(coalesce(p, ''))), '');
$$;

-- --- Fuzzy match: find existing givers close to the provided details -------
-- Returns candidates ranked by score. reason='phone'/'email' => exact-normalized
-- match (resolve, no duplicate); otherwise a fuzzy near-match to flag for review.
create or replace function public.find_giver_matches(
  p_name text, p_phone text, p_email text, p_limit int default 5
) returns table (giver_id uuid, full_name text, score real, reason text, is_exact boolean)
language sql stable security definer set search_path = '' as $$
  with n as (
    select public.normalize_phone(p_phone) as phk,
           public.normalize_email(p_email)  as em,
           nullif(trim(coalesce(p_name, '')), '') as nm
  )
  select g.id, g.full_name,
    greatest(
      coalesce(case when n.phk is not null
                    then extensions.similarity(coalesce(public.normalize_phone(g.phone), ''), n.phk) end, 0),
      coalesce(case when n.em is not null
                    then extensions.similarity(coalesce(public.normalize_email(g.email), ''), n.em) end, 0),
      coalesce(case when n.nm is not null
                    then extensions.similarity(g.full_name, n.nm) end, 0)
    )::real as score,
    case
      when n.phk is not null and public.normalize_phone(g.phone) = n.phk then 'phone'
      when n.em  is not null and public.normalize_email(g.email) = n.em  then 'email'
      else 'name/near'
    end as reason,
    (   (n.phk is not null and public.normalize_phone(g.phone) = n.phk)
     or (n.em  is not null and public.normalize_email(g.email) = n.em) ) as is_exact
  from public.givers g, n
  where g.is_active
    and (n.phk is not null or n.em is not null or n.nm is not null)
  order by is_exact desc, score desc
  limit p_limit;
$$;
grant execute on function public.find_giver_matches(text, text, text, int) to authenticated, service_role;

-- --- Post a giving record to the ledger (double-entry) ---------------------
-- Debit cash/bank (by channel), credit the giving type's income account.
-- This is a SYSTEM posting (recorded income), so it is not subject to the
-- approver<>creator segregation-of-duties rule that governs expense approvals.
create or replace function public.post_giving_record(p_giving_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  g            public.giving_records;
  v_credit     uuid;
  v_fund       public.fund_classification;
  v_debit      uuid;
  v_type_name  text;
  v_je         uuid;
begin
  select * into g from public.giving_records where id = p_giving_id;
  if not found then
    raise exception 'Giving record % not found', p_giving_id using errcode = 'check_violation';
  end if;
  if g.journal_entry_id is not null then
    raise exception 'Giving record % is already posted', p_giving_id using errcode = 'check_violation';
  end if;

  select default_account_id, default_fund_classification, name
    into v_credit, v_fund, v_type_name
  from public.giving_types where id = g.giving_type_id;

  select id into v_debit from public.accounts
  where code = case when g.channel = 'cash' then '1000' else '1010' end;

  insert into public.journal_entries
    (entity_id, transaction_date, description, source_module, created_by, status)
  values
    (g.entity_id, g.transaction_date, 'Giving: ' || v_type_name, 'giving', g.recorded_by, 'draft')
  returning id into v_je;

  insert into public.journal_entry_lines
    (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
  values
    (v_je, v_debit,  g.entity_id, g.amount, 0, v_fund, g.currency),
    (v_je, v_credit, g.entity_id, 0, g.amount, v_fund, g.currency);

  update public.journal_entries set status = 'posted' where id = v_je;  -- validates balance
  update public.giving_records set journal_entry_id = v_je where id = p_giving_id;
  return v_je;
end $$;
revoke all on function public.post_giving_record(uuid) from public, anon, authenticated;

-- --- Merge two givers (resolve a duplicate) --------------------------------
create or replace function public.merge_givers(p_keep uuid, p_merge uuid, p_actor uuid default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_keep = p_merge then
    raise exception 'Cannot merge a giver into itself' using errcode = 'check_violation';
  end if;

  -- Repoint history and receivables to the surviving giver.
  update public.giving_records set giver_id = p_keep where giver_id = p_merge;
  update public.pledges        set giver_id = p_keep where giver_id = p_merge;

  -- Move identifiers, dropping ones the survivor already has.
  delete from public.giver_identifiers d
  where d.giver_id = p_merge
    and exists (select 1 from public.giver_identifiers k
                where k.giver_id = p_keep
                  and k.identifier_type = d.identifier_type
                  and k.identifier_value = d.identifier_value);
  update public.giver_identifiers set giver_id = p_keep where giver_id = p_merge;

  update public.givers set is_active = false where id = p_merge;

  update public.giver_merge_candidates
     set status = 'merged', resolved_by = p_actor, resolved_at = now()
   where status = 'pending'
     and (p_merge in (giver_id_a, giver_id_b) or p_keep in (giver_id_a, giver_id_b));
end $$;
revoke all on function public.merge_givers(uuid, uuid, uuid) from public, anon, authenticated;

-- --- Pledge status auto-update on fulfillment ------------------------------
create or replace function app_private.tg_pledge_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_out numeric;
begin
  select p.total_pledged_amount
         - coalesce((select sum(amount) from public.pledge_fulfillments where pledge_id = p.id), 0)
    into v_out
  from public.pledges p where p.id = new.pledge_id;

  if v_out <= 0 then
    update public.pledges set status = 'fulfilled'
    where id = new.pledge_id and status <> 'fulfilled';
  end if;
  return new;
end $$;
drop trigger if exists trg_pledge_status on public.pledge_fulfillments;
create trigger trg_pledge_status after insert on public.pledge_fulfillments
  for each row execute function app_private.tg_pledge_status();

-- --- Pledge balances + AR-style aging view ---------------------------------
create or replace view public.pledge_balances with (security_invoker = true) as
  select p.id, p.giver_id, p.entity_id, p.pledge_type, p.currency,
         p.total_pledged_amount, p.start_date, p.target_fulfillment_date, p.status,
         coalesce(sum(pf.amount), 0) as fulfilled_amount,
         p.total_pledged_amount - coalesce(sum(pf.amount), 0) as outstanding_amount
  from public.pledges p
  left join public.pledge_fulfillments pf on pf.pledge_id = p.id
  group by p.id;

create or replace view public.pledge_aging with (security_invoker = true) as
  select b.id as pledge_id, b.entity_id, e.name as entity_name,
         b.giver_id, gv.full_name as giver_name,
         b.pledge_type, b.currency, b.total_pledged_amount, b.fulfilled_amount,
         b.outstanding_amount, b.target_fulfillment_date, b.status,
         case
           when b.outstanding_amount <= 0 then 'fulfilled'
           when b.target_fulfillment_date is null then 'no_due_date'
           when current_date <= b.target_fulfillment_date then 'current'
           when current_date - b.target_fulfillment_date <= 30 then '1-30'
           when current_date - b.target_fulfillment_date <= 60 then '31-60'
           when current_date - b.target_fulfillment_date <= 90 then '61-90'
           else '90+'
         end as aging_bucket
  from public.pledge_balances b
  join public.entities e on e.id = b.entity_id
  left join public.givers gv on gv.id = b.giver_id;

-- ===========================================================================
-- Audit: attach the reusable trigger to the new tables.
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'givers','giver_identifiers','giver_merge_candidates','giving_types',
    'giving_records','pledges','pledge_fulfillments'
  ] loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format(
      'create trigger trg_audit after insert or update or delete on public.%I
         for each row execute function app_private.tg_audit()', t);
  end loop;
end $$;

-- ===========================================================================
-- RLS. Records/pledges are entity-scoped; giver identity + reference data are
-- readable by any authenticated staff member. Writes go through server code.
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'givers','giver_identifiers','giver_merge_candidates','giving_types',
    'giving_records','pledges','pledge_fulfillments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Entity-scoped reads
drop policy if exists giving_records_select on public.giving_records;
create policy giving_records_select on public.giving_records for select to authenticated
  using (public.user_can_access_entity(entity_id));

drop policy if exists pledges_select on public.pledges;
create policy pledges_select on public.pledges for select to authenticated
  using (public.user_can_access_entity(entity_id));

drop policy if exists pledge_fulfillments_select on public.pledge_fulfillments;
create policy pledge_fulfillments_select on public.pledge_fulfillments for select to authenticated
  using (exists (select 1 from public.pledges p
                 where p.id = pledge_id and public.user_can_access_entity(p.entity_id)));

-- Giver identity + reference data: readable by any authenticated staff member.
drop policy if exists givers_select on public.givers;
create policy givers_select on public.givers for select to authenticated using (true);

drop policy if exists giver_identifiers_select on public.giver_identifiers;
create policy giver_identifiers_select on public.giver_identifiers for select to authenticated using (true);

drop policy if exists giver_merge_candidates_select on public.giver_merge_candidates;
create policy giver_merge_candidates_select on public.giver_merge_candidates for select to authenticated using (true);

drop policy if exists giving_types_select on public.giving_types;
create policy giving_types_select on public.giving_types for select to authenticated using (true);
