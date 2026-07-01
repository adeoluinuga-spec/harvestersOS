-- ===========================================================================
-- Harvesters Finance OS - 0016 Seeded role slots
-- Tracks placeholder test accounts/roles so real people can later replace
-- seeded users without losing the intended org/cadre structure.
-- ===========================================================================

create table if not exists public.seeded_role_slots (
  id uuid primary key default gen_random_uuid(),
  slot_key text not null unique,
  cadre text not null,
  placeholder_email text not null,
  current_user_id uuid references auth.users(id) on delete set null,
  entity_id uuid references public.entities(id) on delete cascade,
  role public.app_role not null,
  is_placeholder boolean not null default true,
  converted_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_seeded_role_slots_entity on public.seeded_role_slots(entity_id);
create index if not exists idx_seeded_role_slots_user on public.seeded_role_slots(current_user_id);

do $$
begin
  alter table public.seeded_role_slots enable row level security;
  revoke all on public.seeded_role_slots from anon, authenticated;
  grant select on public.seeded_role_slots to authenticated;
  grant all on public.seeded_role_slots to service_role;
  drop trigger if exists trg_audit on public.seeded_role_slots;
  create trigger trg_audit after insert or update or delete on public.seeded_role_slots
    for each row execute function app_private.tg_audit();
end $$;

drop policy if exists seeded_role_slots_select on public.seeded_role_slots;
create policy seeded_role_slots_select on public.seeded_role_slots for select to authenticated
  using (
    public.is_super_admin()
    or public.is_auditor()
    or (entity_id is not null and public.user_can_access_entity(entity_id))
  );
