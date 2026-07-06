import { afterAll, describe, expect, it } from "vitest";
import { inRollback, makeDraftEntry, makeEntity, post, sql } from "./helpers";

afterAll(async () => {
  await sql.end();
});

describe("audit log partitioning (0034)", () => {
  it("keeps auditing writes, routing rows to the month partition", async () => {
    await inRollback(async (tx) => {
      const [before] = await tx<{ n: string }[]>`select count(*) n from public.audit_log`;
      const entity = await makeEntity(tx); // insert fires the audit trigger
      const [after] = await tx<{ n: string }[]>`select count(*) n from public.audit_log`;
      expect(Number(after.n)).toBeGreaterThan(Number(before.n));

      // The new row landed in the current-month partition, not the default.
      const part = `audit_log_y${new Date().getUTCFullYear()}m${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
      const [inPart] = await tx<{ n: string }[]>`
        select count(*) n from public.audit_log al
        where al.tableoid = (${"public." + part})::regclass
          and al.record_id = ${entity}`;
      expect(Number(inPart.n)).toBeGreaterThan(0);
    });
  });

  it("history survived the conversion intact", async () => {
    const [row] = await sql<{ n: string; parts: string }[]>`
      select (select count(*) from public.audit_log)::text n,
             (select count(*) from pg_inherits
              where inhparent = 'public.audit_log'::regclass)::text parts`;
    expect(Number(row.n)).toBeGreaterThan(10_000); // seeded history preserved
    expect(Number(row.parts)).toBeGreaterThan(2);  // months + default
  });
});

describe("trial balance (0035)", () => {
  it("balances and reflects new postings, scoped by entity", async () => {
    await inRollback(async (tx) => {
      const entity = await makeEntity(tx);
      const je = await makeDraftEntry(tx, entity, { amount: 777_000 });
      await post(tx, je);

      const rows = await tx<{ account_type: string; debit_ngn: string; credit_ngn: string }[]>`
        select account_type::text, debit_ngn::text, credit_ngn::text
        from public.trial_balance(current_date - 1, current_date, array[${entity}]::uuid[], false)`;
      const debit = rows.reduce((s, r) => s + Number(r.debit_ngn), 0);
      const credit = rows.reduce((s, r) => s + Number(r.credit_ngn), 0);
      expect(debit).toBe(777_000);
      expect(credit).toBe(777_000);

      // Scoping: a different (empty) entity sees nothing.
      const other = await makeEntity(tx, `Other ${Date.now()}`);
      const none = await tx`
        select * from public.trial_balance(current_date - 1, current_date, array[${other}]::uuid[], false)`;
      expect(none.length).toBe(0);
    });
  });
});
