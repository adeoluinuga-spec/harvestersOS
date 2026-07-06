-- ===========================================================================
-- Harvesters Finance OS — 0022 New source module: closing
-- Year-end closing entries (income/expense -> retained earnings) get their own
-- ledger source so every report can distinguish operating activity from the
-- mechanical equity roll. Kept in its own migration: an enum value added in a
-- transaction cannot be used until that transaction commits.
-- ===========================================================================

alter type public.source_module add value if not exists 'closing';
