import { afterAll, describe, expect, it } from "vitest";
import {
  expectError,
  getAccounts,
  inRollback,
  makeDraftEntry,
  makeEntity,
  post,
  sql,
} from "./helpers";

afterAll(async () => {
  await sql.end();
});

describe("ledger integrity (0002)", () => {
  it("rejects posting an unbalanced entry", async () => {
    await inRollback(async (tx) => {
      const entity = await makeEntity(tx);
      const { cash, income } = await getAccounts(tx);
      const [je] = await tx<{ id: string }[]>`
        insert into public.journal_entries (entity_id, transaction_date, source_module)
        values (${entity}, current_date, 'adjustment') returning id`;
      await tx`
        insert into public.journal_entry_lines
          (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
        values
          (${je.id}, ${cash}, ${entity}, 1000, 0, 'unrestricted', 'NGN'),
          (${je.id}, ${income}, ${entity}, 0, 999, 'unrestricted', 'NGN')`;
      const msg = await expectError(tx, (sp) => post(sp, je.id));
      expect(msg).toMatch(/unbalanced/i);
    });
  });

  it("rejects inserting an entry directly as posted", async () => {
    await inRollback(async (tx) => {
      const entity = await makeEntity(tx);
      const msg = await expectError(
        tx,
        (sp) => sp`
          insert into public.journal_entries (entity_id, transaction_date, source_module, status)
          values (${entity}, current_date, 'adjustment', 'posted')`
      );
      expect(msg).toMatch(/draft/i);
    });
  });

  it("makes posted entries and their lines immutable", async () => {
    await inRollback(async (tx) => {
      const entity = await makeEntity(tx);
      const je = await makeDraftEntry(tx, entity);
      await post(tx, je);

      expect(await expectError(tx, (sp) => sp`
        update public.journal_entries set description = 'tampered' where id = ${je}`)).toMatch(/immutable/i);
      expect(await expectError(tx, (sp) => sp`
        delete from public.journal_entries where id = ${je}`)).toMatch(/immutable/i);
      expect(await expectError(tx, (sp) => sp`
        update public.journal_entry_lines set debit_amount = 2 where journal_entry_id = ${je} and debit_amount > 0`)).toMatch(/immutable/i);
      expect(await expectError(tx, (sp) => sp`
        delete from public.journal_entry_lines where journal_entry_id = ${je}`)).toMatch(/immutable/i);
    });
  });

  it("reverses via a new balanced entry, never by edit", async () => {
    await inRollback(async (tx) => {
      const entity = await makeEntity(tx);
      const je = await makeDraftEntry(tx, entity, { amount: 5000 });
      await post(tx, je);

      const [{ reverse_journal_entry: revId }] = await tx<{ reverse_journal_entry: string }[]>`
        select public.reverse_journal_entry(${je}, 'test reversal')`;

      const [orig] = await tx<{ status: string }[]>`
        select status from public.journal_entries where id = ${je}`;
      expect(orig.status).toBe("reversed");

      const [rev] = await tx<{ status: string; reversal_of_entry_id: string }[]>`
        select status, reversal_of_entry_id from public.journal_entries where id = ${revId}`;
      expect(rev.status).toBe("posted");
      expect(rev.reversal_of_entry_id).toBe(je);

      // Original + reversal must net to zero.
      const [net] = await tx<{ d: string; c: string }[]>`
        select coalesce(sum(debit_amount),0) d, coalesce(sum(credit_amount),0) c
        from public.journal_entry_lines where journal_entry_id in (${je}, ${revId})`;
      expect(Number(net.d)).toBe(Number(net.c));
    });
  });

  it("blocks self-approval (segregation of duties backstop)", async () => {
    await inRollback(async (tx) => {
      const [user] = await tx<{ id: string }[]>`select id from auth.users limit 1`;
      if (!user) return; // no users in a pristine DB — nothing to assert
      const entity = await makeEntity(tx);
      const je = await makeDraftEntry(tx, entity, { createdBy: user.id });
      const msg = await expectError(tx, (sp) => post(sp, je, user.id));
      expect(msg).toMatch(/segregation of duties/i);
    });
  });
});

describe("accounting periods & numbering (0023)", () => {
  it("rejects posting a future-dated entry", async () => {
    await inRollback(async (tx) => {
      const entity = await makeEntity(tx);
      const future = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
      const je = await makeDraftEntry(tx, entity, { date: future });
      const msg = await expectError(tx, (sp) => post(sp, je));
      expect(msg).toMatch(/future/i);
    });
  });

  it("rejects posting into a closed period and allows it after reopen", async () => {
    await inRollback(async (tx) => {
      const entity = await makeEntity(tx);
      const lastMonth = new Date();
      lastMonth.setDate(0); // last day of previous month
      const date = lastMonth.toISOString().slice(0, 10);
      const periodStart = date.slice(0, 8) + "01";

      await tx`select public.close_fiscal_period(${periodStart}::date, null)`;
      const je = await makeDraftEntry(tx, entity, { date });
      const msg = await expectError(tx, (sp) => post(sp, je));
      expect(msg).toMatch(/closed/i);

      await tx`select public.reopen_fiscal_period(${periodStart}::date, null)`;
      await post(tx, je);
      const [row] = await tx<{ status: string }[]>`
        select status from public.journal_entries where id = ${je}`;
      expect(row.status).toBe("posted");
    });
  });

  it("assigns gapless sequential entry numbers per entity per year", async () => {
    await inRollback(async (tx) => {
      const entity = await makeEntity(tx);
      const year = new Date().getFullYear();
      const a = await makeDraftEntry(tx, entity);
      const b = await makeDraftEntry(tx, entity);
      await post(tx, a);
      await post(tx, b);
      const rows = await tx<{ id: string; entry_number: string }[]>`
        select id, entry_number from public.journal_entries where id in (${a}, ${b})`;
      const byId = new Map(rows.map((r) => [r.id, r.entry_number]));
      expect(byId.get(a)).toBe(`JE-${year}-000001`);
      expect(byId.get(b)).toBe(`JE-${year}-000002`);
    });
  });

  it("forbids client-supplied entry numbers", async () => {
    await inRollback(async (tx) => {
      const entity = await makeEntity(tx);
      const msg = await expectError(
        tx,
        (sp) => sp`
          insert into public.journal_entries (entity_id, transaction_date, source_module, entry_number)
          values (${entity}, current_date, 'adjustment', 'JE-9999-000001')`
      );
      expect(msg).toMatch(/system-assigned/i);
    });
  });
});

describe("giving capture (0024)", () => {
  it("captures amount_ngn at write time and enforces client_key idempotency", async () => {
    await inRollback(async (tx) => {
      const entity = await makeEntity(tx);
      const [type] = await tx<{ id: string }[]>`
        select id from public.giving_types where is_active limit 1`;
      const key = crypto.randomUUID();

      const [gr] = await tx<{ id: string; amount_ngn: string }[]>`
        insert into public.giving_records
          (entity_id, recording_entity_id, attribution_entity_id, giving_type_id,
           amount, currency, channel, transaction_date, client_key)
        values (${entity}, ${entity}, ${entity}, ${type.id},
                1000, 'NGN', 'cash', current_date, ${key})
        returning id, amount_ngn`;
      expect(Number(gr.amount_ngn)).toBe(1000);

      const msg = await expectError(
        tx,
        (sp) => sp`
          insert into public.giving_records
            (entity_id, recording_entity_id, attribution_entity_id, giving_type_id,
             amount, currency, channel, transaction_date, client_key)
          values (${entity}, ${entity}, ${entity}, ${type.id},
                  1000, 'NGN', 'cash', current_date, ${key})`
      );
      expect(msg).toMatch(/duplicate key|uq_giving_client_key/i);
    });
  });
});
