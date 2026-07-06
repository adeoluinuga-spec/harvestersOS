import { afterAll, describe, expect, it } from "vitest";
import { expectError, inRollback, makeEntity, sql, type Tx } from "./helpers";

afterAll(async () => {
  await sql.end();
});

async function capitalize(tx: Tx, entity: string, cost = 1_200_000, lifeMonths = 12) {
  const [row] = await tx<{ capitalize_fixed_asset: string }[]>`
    select public.capitalize_fixed_asset(
      ${entity}, 'Test Generator', 'generator',
      (date_trunc('month', current_date) - interval '3 months')::date,
      ${cost}, 0, ${lifeMonths}, 'bank', null)`;
  return row.capitalize_fixed_asset;
}

describe("fixed assets (0030)", () => {
  it("capitalizes through the ledger and depreciates straight-line, idempotently", async () => {
    await inRollback(async (tx) => {
      const entity = await makeEntity(tx);
      const assetId = await capitalize(tx, entity, 1_200_000, 12);

      // Capitalization posted: 1500 debit balance = cost.
      const [cap] = await tx<{ bal: string }[]>`
        select coalesce(sum(l.debit_amount - l.credit_amount),0) bal
        from public.journal_entry_lines l
        join public.accounts a on a.id = l.account_id and a.code = '1500'
        where l.entity_id = ${entity}`;
      expect(Number(cap.bal)).toBe(1_200_000);

      // Depreciate two months back: 1,200,000/12 = 100,000.
      const period = await tx<{ p: string }[]>`
        select (date_trunc('month', current_date) - interval '2 months')::date::text p`;
      const [run1] = await tx<{ run_monthly_depreciation: { total_amount: number } }[]>`
        select public.run_monthly_depreciation(${period[0].p}::date, null)`;
      expect(Number(run1.run_monthly_depreciation.total_amount)).toBe(100_000);

      // Re-running the same month is a no-op.
      const [run2] = await tx<{ run_monthly_depreciation: { total_amount: number } }[]>`
        select public.run_monthly_depreciation(${period[0].p}::date, null)`;
      expect(Number(run2.run_monthly_depreciation.total_amount)).toBe(0);

      // Register derives accumulated + NBV.
      const [reg] = await tx<{ accumulated_depreciation: string; net_book_value: string }[]>`
        select accumulated_depreciation::text, net_book_value::text
        from public.fixed_asset_register where id = ${assetId}`;
      expect(Number(reg.accumulated_depreciation)).toBe(100_000);
      expect(Number(reg.net_book_value)).toBe(1_100_000);
    });
  });

  it("disposal posts gain/loss and closes the asset", async () => {
    await inRollback(async (tx) => {
      const entity = await makeEntity(tx);
      const assetId = await capitalize(tx, entity, 600_000, 6);
      // Sell with no depreciation yet, proceeds 650k => 50k gain.
      await tx`select public.dispose_fixed_asset(${assetId}, current_date, 650000, null)`;
      const [a] = await tx<{ status: string }[]>`
        select status from public.fixed_assets where id = ${assetId}`;
      expect(a.status).toBe("disposed");
      const [gain] = await tx<{ bal: string }[]>`
        select coalesce(sum(l.credit_amount - l.debit_amount),0) bal
        from public.journal_entry_lines l
        join public.accounts a on a.id = l.account_id and a.code = '4090'
        where l.entity_id = ${entity}`;
      expect(Number(gain.bal)).toBe(50_000);
    });
  });
});

describe("online giving (0031)", () => {
  it("records an exact-match payment as a posted, reconciled gift; queues ambiguity", async () => {
    await inRollback(async (tx) => {
      const entity = await makeEntity(tx);
      // A giver with a known phone (exact identifier match path).
      const [giver] = await tx<{ id: string }[]>`
        insert into public.givers (full_name, phone, primary_entity_id)
        values ('Web Giver', '08099887766', ${entity}) returning id`;
      await tx`
        insert into public.giver_identifiers (giver_id, identifier_type, identifier_value)
        values (${giver.id}, 'phone', public.normalize_phone('08099887766'))`;

      const [ev] = await tx<{ id: string }[]>`
        insert into public.online_payment_events
          (provider, event_id, event_type, reference, amount, currency, paid_at,
           payer_email, payer_phone, payer_name, entity_id)
        values ('paystack', 'evt-test-1', 'charge.success', 'ref-1', 25000, 'NGN', now(),
                null, '08099887766', 'Web Giver', ${entity})
        returning id`;

      const [r] = await tx<{ process_online_payment: string }[]>`
        select public.process_online_payment(${ev.id}, null, null)`;
      expect(r.process_online_payment).toBe("recorded");

      const [gift] = await tx<{ giver_id: string; reconciliation_status: string; journal_entry_id: string }[]>`
        select gr.giver_id, gr.reconciliation_status, gr.journal_entry_id
        from public.online_payment_events ope
        join public.giving_records gr on gr.id = ope.giving_record_id
        where ope.id = ${ev.id}`;
      expect(gift.giver_id).toBe(giver.id);
      expect(gift.reconciliation_status).toBe("matched");

      const [je] = await tx<{ status: string }[]>`
        select status from public.journal_entries where id = ${gift.journal_entry_id}`;
      expect(je.status).toBe("posted");

      // Idempotent: reprocessing changes nothing.
      const [r2] = await tx<{ process_online_payment: string }[]>`
        select public.process_online_payment(${ev.id}, null, null)`;
      expect(r2.process_online_payment).toBe("recorded");

      // Unknown payer -> review queue, no gift.
      const [ev2] = await tx<{ id: string }[]>`
        insert into public.online_payment_events
          (provider, event_id, event_type, amount, currency, payer_email, entity_id)
        values ('paystack', 'evt-test-2', 'charge.success', 10000, 'NGN',
                'stranger@example.com', ${entity})
        returning id`;
      const [r3] = await tx<{ process_online_payment: string }[]>`
        select public.process_online_payment(${ev2.id}, null, null)`;
      expect(r3.process_online_payment).toBe("needs_review");
    });
  });
});

describe("WHT + intercompany (0032)", () => {
  it("cross-border posting is balanced and eliminates on consolidation", async () => {
    await inRollback(async (tx) => {
      const sender = await makeEntity(tx, `Sender ${Date.now()}`);
      const receiver = await makeEntity(tx, `Receiver ${Date.now()}`);
      const [approver] = await tx<{ id: string }[]>`select id from auth.users limit 1`;
      const [t] = await tx<{ id: string }[]>`
        insert into public.cross_border_transfers
          (sending_entity_id, receiving_entity_id, direction, purpose, amount, currency,
           supporting_documentation_url, compliance_status, approved_by, reviewed_at)
        values (${sender}, ${receiver}, 'hq_to_international', 'missions_support',
                5000000, 'NGN', 'https://example.org/doc.pdf', 'documented',
                ${approver.id}, now())
        returning id`;
      await tx`select public.post_cross_border_transfer(${t.id}, null)`;

      // Due-from (sender) equals due-to (receiver): the tie-out nets to zero.
      const [bal] = await tx<{ due_from: string; due_to: string }[]>`
        select
          coalesce(sum(l.debit_amount - l.credit_amount) filter (where a.code = '1900'), 0)::text due_from,
          coalesce(sum(l.credit_amount - l.debit_amount) filter (where a.code = '2900'), 0)::text due_to
        from public.journal_entry_lines l
        join public.accounts a on a.id = l.account_id
        where l.entity_id in (${sender}, ${receiver})`;
      expect(Number(bal.due_from)).toBe(5_000_000);
      expect(Number(bal.due_to)).toBe(5_000_000);

      // Idempotent re-post.
      await tx`select public.post_cross_border_transfer(${t.id}, null)`;
      const [n] = await tx<{ n: number }[]>`
        select count(*)::int n from public.journal_entries
        where entity_id in (${sender}, ${receiver}) and source_module = 'transfer'`;
      expect(n.n).toBe(2);

      // Consolidation emits elimination rows netting the intercompany accounts.
      const elim = await tx<{ net: string }[]>`
        select coalesce(sum(net_historical_ngn), 0)::text net
        from public.consolidated_statement_ngn(current_date - 30, current_date)
        where account_code in ('1900','2900')`;
      expect(Number(elim[0].net)).toBe(0);
    });
  });

  it("undocumented transfers cannot post", async () => {
    await inRollback(async (tx) => {
      const sender = await makeEntity(tx, `S2 ${Date.now()}`);
      const receiver = await makeEntity(tx, `R2 ${Date.now()}`);
      const [t] = await tx<{ id: string }[]>`
        insert into public.cross_border_transfers
          (sending_entity_id, receiving_entity_id, direction, purpose, amount, currency)
        values (${sender}, ${receiver}, 'hq_to_international', 'missions_support', 100, 'NGN')
        returning id`;
      const msg = await expectError(tx, (sp) => sp`select public.post_cross_border_transfer(${t.id}, null)`);
      expect(msg).toMatch(/documented/i);
    });
  });
});
