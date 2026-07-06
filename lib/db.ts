import "server-only";
import postgres from "postgres";

/**
 * Server-only Postgres connections.
 *
 * `sql` — the application connection. Uses the least-privilege `hfos_app`
 * login (APP_DATABASE_URL, provisioned by scripts/provision-db-roles.mjs):
 * DML + sanctioned functions only, no DDL, statement-timeout bounded. Falls
 * back to DATABASE_URL (owner) so a fresh environment still boots before
 * provisioning. Ledger integrity is enforced by database triggers either way.
 *
 * `aiSql` — the "Ask the ledger" connection. Uses `hfos_ai` (AI_DATABASE_URL):
 * SELECT on the approved analytics views' closure only, forced read-only,
 * 10s statement timeout. AI-generated SQL must never run on `sql`.
 *
 * NEVER import this module from a Client Component.
 */
const globalForDb = globalThis as unknown as {
  __hfos_sql?: ReturnType<typeof postgres>;
  __hfos_ai_sql?: ReturnType<typeof postgres>;
};

export const sql =
  globalForDb.__hfos_sql ??
  postgres(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL!, {
    ssl: "require",
    prepare: false,
    max: 10,
  });

/** Read-only analytics connection for AI-generated queries (hfos_ai role). */
export const aiSql =
  globalForDb.__hfos_ai_sql ??
  (process.env.AI_DATABASE_URL
    ? postgres(process.env.AI_DATABASE_URL, {
        ssl: "require",
        prepare: false,
        max: 2,
      })
    : sql);

if (process.env.NODE_ENV !== "production") {
  globalForDb.__hfos_sql = sql;
  globalForDb.__hfos_ai_sql = aiSql;
}

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
