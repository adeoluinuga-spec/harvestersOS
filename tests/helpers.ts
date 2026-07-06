import fs from "node:fs";
import postgres from "postgres";

// Load .env.local when running outside `node --env-file` (e.g. plain vitest).
if (!process.env.DATABASE_URL && fs.existsSync(".env.local")) {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run the database test suite.");
}

/** Owner connection — triggers fire for it too, which is what we assert. */
export const sql = postgres(process.env.DATABASE_URL, {
  ssl: "require",
  prepare: false,
  max: 2,
});

// Loose executor type: the base client or a transaction/savepoint handle.
export type Tx = typeof sql;

const ROLLBACK = Symbol("rollback");

/**
 * Run assertions inside a transaction that is ALWAYS rolled back — posted
 * entries created by tests never pollute the immutable ledger.
 */
export async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await fn(tx as unknown as Tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

/**
 * Expect `fn` to raise. Runs in a savepoint so the enclosing transaction
 * survives the expected failure. Returns the error message.
 */
export async function expectError(tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<string> {
  try {
    // @ts-expect-error postgres.js exposes savepoint on the tx handle
    await tx.savepoint((sp: Tx) => fn(sp));
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("Expected the statement to be rejected, but it succeeded.");
}

/** A fresh throwaway entity (rolled back with the transaction). */
export async function makeEntity(tx: Tx, name = `Test Campus ${Date.now()}`): Promise<string> {
  const [root] = await tx<{ id: string }[]>`
    select id from public.entities where parent_entity_id is null order by created_at limit 1`;
  const [e] = await tx<{ id: string }[]>`
    insert into public.entities (type, parent_entity_id, name, country, functional_currency)
    values ('campus', ${root.id}, ${name}, 'NG', 'NGN') returning id`;
  return e.id;
}

/** Cash + income account ids from the seeded chart of accounts. */
export async function getAccounts(tx: Tx) {
  const [cash] = await tx<{ id: string }[]>`
    select id from public.accounts where account_type = 'asset' order by code limit 1`;
  const [income] = await tx<{ id: string }[]>`
    select id from public.accounts where account_type = 'income' order by code limit 1`;
  return { cash: cash.id, income: income.id };
}

/** Insert a balanced draft entry (1 debit / 1 credit) and return its id. */
export async function makeDraftEntry(
  tx: Tx,
  entityId: string,
  opts: { amount?: number; date?: string; createdBy?: string | null } = {}
): Promise<string> {
  const { cash, income } = await getAccounts(tx);
  const amount = opts.amount ?? 1000;
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const [je] = await tx<{ id: string }[]>`
    insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by)
    values (${entityId}, ${date}::date, 'test entry', 'adjustment', ${opts.createdBy ?? null})
    returning id`;
  await tx`
    insert into public.journal_entry_lines
      (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
    values
      (${je.id}, ${cash}, ${entityId}, ${amount}, 0, 'unrestricted', 'NGN'),
      (${je.id}, ${income}, ${entityId}, 0, ${amount}, 'unrestricted', 'NGN')`;
  return je.id;
}

export async function post(tx: Tx, entryId: string, approver: string | null = null) {
  await tx`select public.post_journal_entry(${entryId}, ${approver})`;
}
