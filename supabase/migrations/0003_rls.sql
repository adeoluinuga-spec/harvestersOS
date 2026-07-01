-- ===========================================================================
-- Harvesters Finance OS — 0003 Row Level Security
-- RLS is ON for every table from the start. In Phase 1 there is no roles model
-- yet, so the baseline is deliberately tight:
--   • anon         -> no access at all
--   • authenticated-> read-only (SELECT); no writes
--   • service_role -> full access (bypasses RLS); used by trusted server code
--   • owner (postgres) -> full access (used for admin + migrations)
-- Ledger integrity does NOT depend on RLS — it is enforced by triggers (0002)
-- which fire for every writer. Role-based write policies arrive with the auth
-- phase.
-- ===========================================================================

alter table public.entities            enable row level security;
alter table public.accounts            enable row level security;
alter table public.journal_entries     enable row level security;
alter table public.journal_entry_lines enable row level security;
alter table public.bank_accounts       enable row level security;

-- Strip any default grants, then hand back exactly what each role should have.
revoke all on public.entities, public.accounts, public.journal_entries,
              public.journal_entry_lines, public.bank_accounts
  from anon, authenticated;

grant select on public.entities, public.accounts, public.journal_entries,
                public.journal_entry_lines, public.bank_accounts
  to authenticated;

grant all on public.entities, public.accounts, public.journal_entries,
             public.journal_entry_lines, public.bank_accounts
  to service_role;

-- SELECT policies for authenticated. anon has no policy => no access.
drop policy if exists entities_select on public.entities;
create policy entities_select on public.entities
  for select to authenticated using (true);

drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts
  for select to authenticated using (true);

drop policy if exists journal_entries_select on public.journal_entries;
create policy journal_entries_select on public.journal_entries
  for select to authenticated using (true);

drop policy if exists journal_entry_lines_select on public.journal_entry_lines;
create policy journal_entry_lines_select on public.journal_entry_lines
  for select to authenticated using (true);

-- Bank accounts: authenticated may see metadata + encrypted blob only.
-- Plaintext is obtainable exclusively via the restricted decrypt function.
drop policy if exists bank_accounts_select on public.bank_accounts;
create policy bank_accounts_select on public.bank_accounts
  for select to authenticated using (true);
