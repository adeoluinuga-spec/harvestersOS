-- ===========================================================================
-- Harvesters Finance OS — 0004 Auth, roles, segregation of duties, audit
-- Entity-scoped RBAC mirroring the org hierarchy, SoD enforcement on posting,
-- and automatic audit logging via a single reusable trigger.
-- ===========================================================================

-- --- Role enum -------------------------------------------------------------
do $$ begin create type public.app_role as enum (
  'super_admin',                 -- Group level, global
  'group_finance_officer',
  'sub_group_pastor',
  'sub_group_finance_officer',
  'campus_pastor',
  'campus_finance_officer',
  'campus_data_entry_clerk',
  'auditor',                     -- read-only, all entities, global
  'ministry_lead',               -- Next Level Prayers / other expressions
  'event_finance_lead'
); exception when duplicate_object then null; end $$;

-- --- User <-> entity <-> role assignments ----------------------------------
-- A role is scoped to a specific entity, EXCEPT super_admin and auditor which
-- are global (entity_id must be null).
create table if not exists public.user_entity_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  entity_id  uuid references public.entities(id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  constraint uer_scope_matches_role check (
    (role in ('super_admin','auditor') and entity_id is null)
    or (role not in ('super_admin','auditor') and entity_id is not null)
  )
);
-- One scoped role per (user, entity, role); one global role per (user, role).
create unique index if not exists uer_scoped_uniq
  on public.user_entity_roles(user_id, entity_id, role) where entity_id is not null;
create unique index if not exists uer_global_uniq
  on public.user_entity_roles(user_id, role) where entity_id is null;
create index if not exists idx_uer_user on public.user_entity_roles(user_id);
create index if not exists idx_uer_entity on public.user_entity_roles(entity_id);

-- --- Actor resolution ------------------------------------------------------
-- Writes from trusted server code run over the owner connection (no JWT), so we
-- resolve the actor from a transaction-local setting, falling back to the JWT.
create or replace function app_private.current_actor()
returns uuid language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('app.current_user_id', true), '')::uuid,
    auth.uid()
  );
$$;

-- --- Permission helpers (SECURITY DEFINER => usable inside RLS safely) ------
create or replace function public.is_super_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.user_entity_roles
                where user_id = uid and role = 'super_admin');
$$;

create or replace function public.is_auditor(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.user_entity_roles
                where user_id = uid and role = 'auditor');
$$;

-- Entities a user may access: assigned entities PLUS all their descendants;
-- global roles (super_admin/auditor) see every entity.
create or replace function public.accessible_entity_ids(uid uuid default auth.uid())
returns setof uuid language sql stable security definer set search_path = '' as $$
  with recursive
  glob as (
    select exists(
      select 1 from public.user_entity_roles
      where user_id = uid and role in ('super_admin','auditor')
    ) as is_global
  ),
  tree as (
    select e.id, e.parent_entity_id
    from public.entities e
    join public.user_entity_roles uer
      on uer.entity_id = e.id and uer.user_id = uid
    union
    select c.id, c.parent_entity_id
    from public.entities c
    join tree t on c.parent_entity_id = t.id
  )
  select e.id from public.entities e cross join glob g where g.is_global
  union
  select id from tree;
$$;

create or replace function public.user_can_access_entity(p_entity uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.accessible_entity_ids(uid) a where a = p_entity);
$$;

grant execute on function public.is_super_admin(uuid),
                         public.is_auditor(uuid),
                         public.accessible_entity_ids(uuid),
                         public.user_can_access_entity(uuid, uuid)
  to authenticated, service_role;

-- ===========================================================================
-- Audit log — the compliance backbone. Automatic; modules never call it.
-- ===========================================================================
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,                 -- resolved via app_private.current_actor()
  action      text not null,        -- create|update|approve|reject|reverse|delete|sod_violation
  table_name  text not null,
  record_id   text,
  entity_id   uuid,                 -- entity context where derivable
  before      jsonb,
  after       jsonb,
  note        text
);
create index if not exists idx_audit_entity on public.audit_log(entity_id);
create index if not exists idx_audit_actor on public.audit_log(actor_id);
create index if not exists idx_audit_time on public.audit_log(occurred_at);
create index if not exists idx_audit_record on public.audit_log(table_name, record_id);

-- Reusable audit trigger. Derives create/update/approve/reverse/delete and the
-- entity context automatically from the row and the status transition.
create or replace function app_private.tg_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_action text;
  v_before jsonb;
  v_after  jsonb;
  v_record text;
  v_entity uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'create'; v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'update'; v_before := to_jsonb(old); v_after := to_jsonb(new);
    if tg_table_name = 'journal_entries' then
      if old.status = 'draft' and new.status = 'posted' then v_action := 'approve';
      elsif old.status = 'posted' and new.status = 'reversed' then v_action := 'reverse';
      end if;
    end if;
  else
    v_action := 'delete'; v_before := to_jsonb(old);
  end if;

  v_record := coalesce(v_after->>'id', v_before->>'id');
  v_entity := coalesce(
    (v_after->>'entity_id')::uuid,
    (v_before->>'entity_id')::uuid,
    case when tg_table_name = 'entities'
         then coalesce(v_after->>'id', v_before->>'id')::uuid end
  );

  insert into public.audit_log
    (actor_id, action, table_name, record_id, entity_id, before, after)
  values
    (app_private.current_actor(), v_action, tg_table_name, v_record, v_entity, v_before, v_after);

  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'entities','accounts','journal_entries','journal_entry_lines',
    'bank_accounts','user_entity_roles'
  ] loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format(
      'create trigger trg_audit after insert or update or delete on public.%I
         for each row execute function app_private.tg_audit()', t);
  end loop;
end $$;

-- ===========================================================================
-- Segregation of duties — the creator of a draft cannot post it.
--   • App layer performs the check BEFORE approving and calls
--     public.log_sod_violation() to durably record any attempt (its own
--     committed write), then refuses.
--   • The DB posting path RAISES as a hard backstop if the check is somehow
--     bypassed. (It deliberately does NOT try to log here: the raise would roll
--     the log back with it — durable logging is the app-layer's job above.)
-- ===========================================================================

-- Durable, committed record of an attempted SoD breach. Called by the app.
create or replace function public.log_sod_violation(
  p_entry_id uuid, p_actor uuid, p_note text default null
) returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_entity uuid;
begin
  select entity_id into v_entity from public.journal_entries where id = p_entry_id;
  insert into public.audit_log (actor_id, action, table_name, record_id, entity_id, note)
  values (p_actor, 'sod_violation', 'journal_entries', p_entry_id::text, v_entity,
          coalesce(p_note, 'Segregation of duties: creator attempted to approve their own entry; blocked'));
end $$;

create or replace function public.post_journal_entry(p_entry_id uuid, p_approved_by uuid default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_creator uuid; v_approver uuid;
begin
  select created_by into v_creator
  from public.journal_entries where id = p_entry_id and status = 'draft';
  if not found then
    raise exception 'Entry % not found or not in draft state', p_entry_id using errcode = 'check_violation';
  end if;

  v_approver := coalesce(p_approved_by, app_private.current_actor());

  -- Hard backstop (durable logging is handled by the app before it gets here).
  if v_approver is not null and v_creator is not null and v_approver = v_creator then
    raise exception 'Segregation of duties: the creator of entry % cannot approve it', p_entry_id
      using errcode = 'check_violation';
  end if;

  update public.journal_entries
     set status = 'posted', approved_by = v_approver
   where id = p_entry_id and status = 'draft';
end $$;
revoke all on function public.post_journal_entry(uuid, uuid),
                      public.log_sod_violation(uuid, uuid, text)
  from public, anon, authenticated;

-- ===========================================================================
-- RLS: new tables + tighten existing SELECT policies to entity scope.
-- (Applies to the authenticated client role; trusted server code uses the
--  owner connection and enforces scope via app guards + these same functions.)
-- ===========================================================================
alter table public.user_entity_roles enable row level security;
alter table public.audit_log         enable row level security;

revoke all on public.user_entity_roles, public.audit_log from anon, authenticated;
grant select on public.user_entity_roles, public.audit_log to authenticated;
grant all on public.user_entity_roles, public.audit_log to service_role;

drop policy if exists uer_select on public.user_entity_roles;
create policy uer_select on public.user_entity_roles for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

-- Audit is visible to compliance roles only, and is append-only for everyone
-- (inserts happen through the SECURITY DEFINER trigger).
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (public.is_super_admin() or public.is_auditor());

-- Entity-scoped SELECT for the ledger + entities + bank accounts.
drop policy if exists entities_select on public.entities;
create policy entities_select on public.entities for select to authenticated
  using (public.user_can_access_entity(id));

drop policy if exists journal_entries_select on public.journal_entries;
create policy journal_entries_select on public.journal_entries for select to authenticated
  using (public.user_can_access_entity(entity_id));

drop policy if exists journal_entry_lines_select on public.journal_entry_lines;
create policy journal_entry_lines_select on public.journal_entry_lines for select to authenticated
  using (public.user_can_access_entity(entity_id));

drop policy if exists bank_accounts_select on public.bank_accounts;
create policy bank_accounts_select on public.bank_accounts for select to authenticated
  using (public.user_can_access_entity(entity_id));

-- accounts_select stays global (chart of accounts is shared, not entity-scoped).

-- ===========================================================================
-- Bootstrap + internal auth convenience (auth.users triggers)
-- ===========================================================================
-- Auto-confirm new users (internal tool; no SMTP). Remove when real email is on.
create or replace function app_private.tg_auto_confirm_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is null then new.email_confirmed_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_auto_confirm_user on auth.users;
create trigger trg_auto_confirm_user before insert on auth.users
  for each row execute function app_private.tg_auto_confirm_user();

-- The first-ever registered user becomes the bootstrap super_admin.
create or replace function app_private.tg_bootstrap_super_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.user_entity_roles where role = 'super_admin') then
    insert into public.user_entity_roles (user_id, entity_id, role, granted_by)
    values (new.id, null, 'super_admin', new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_bootstrap_super_admin on auth.users;
create trigger trg_bootstrap_super_admin after insert on auth.users
  for each row execute function app_private.tg_bootstrap_super_admin();
