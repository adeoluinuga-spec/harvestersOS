# Supabase

This directory will hold the Supabase local configuration and database
migrations for Harvesters Finance OS.

**Phase 0 status:** intentionally empty of schema. No tables, policies, or
migrations exist yet. The very first migration (a later phase) establishes the
**immutable, append-only, double-entry ledger** that every financial module
posts to. Balances are always *derived* from ledger entries — never written
directly — and corrections are reversing entries, never deletes or updates.

## Planned layout

```
supabase/
  config.toml         # supabase CLI config (added when the ledger lands)
  migrations/         # timestamped, append-only SQL migrations
  seed.sql            # non-financial seed data (chart of accounts, roles)
```

## Getting started (later phases)

```bash
# Install the CLI, then:
supabase init
supabase start          # local Postgres + Studio
supabase db diff        # generate migrations from schema changes
```
