import "server-only";
import postgres from "postgres";

/**
 * Server-only Postgres connection (owner role, via the session pooler).
 *
 * Used by the internal admin data layer and scripts. NEVER import this from a
 * Client Component. Ledger integrity is enforced by database triggers, so even
 * this privileged connection cannot mutate posted ledger rows.
 *
 * A single pooled instance is reused across hot reloads in development.
 */
const globalForDb = globalThis as unknown as {
  __hfos_sql?: ReturnType<typeof postgres>;
};

export const sql =
  globalForDb.__hfos_sql ??
  postgres(process.env.DATABASE_URL!, {
    ssl: "require",
    prepare: false,
    max: 3,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__hfos_sql = sql;
