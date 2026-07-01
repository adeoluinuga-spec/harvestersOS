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

/** A postgres.js executor (the base client or a transaction). */
export type Exec = typeof sql;

/**
 * Run `fn` inside a transaction with the audit actor set, so the automatic
 * audit trigger records who performed each write. All admin mutations go
 * through this. Pass the resulting `tx` to repo write functions.
 */
export async function withActor<T>(
  userId: string | null,
  fn: (tx: Exec) => Promise<T>
): Promise<T> {
  return sql.begin(async (tx) => {
    if (userId) await tx`select set_config('app.current_user_id', ${userId}, true)`;
    return fn(tx as unknown as Exec);
  }) as Promise<T>;
}
