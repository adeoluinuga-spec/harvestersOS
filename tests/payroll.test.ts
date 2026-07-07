import { afterAll, describe, expect, it } from "vitest";
import { expectError, inRollback, makeEntity, sql, type Tx } from "./helpers";

afterAll(async () => {
  await sql.end();
});

async function makeStaffWithSalary(tx: Tx, entityId: string, monthly = 900_000) {
  const [s] = await tx<{ id: string }[]>`
    insert into public.staff (entity_id, full_name, staff_type, employment_status, state_of_taxation)
    values (${entityId}, 'Test Staffer', 'administrative', 'employed', 'default')
    returning id`;
  await tx`
    insert into public.compensation_components (staff_id, component_type, amount, currency, is_taxable)
    values (${s.id}, 'base_salary', ${monthly}, 'NGN', true)`;
  return s.id;
}

async function users(tx: Tx) {
  const rows = await tx<{ id: string }[]>`select id from auth.users limit 2`;
  return { a: rows[0]?.id ?? null, b: rows[1]?.id ?? rows[0]?.id ?? null };
}

describe("federated payroll workflow (0037)", () => {
  it("runs the full lifecycle: prepare → submit → approve (accrual + two half batches)", async () => {
    await inRollback(async (tx) => {
      const { a, b } = await users(tx);
      if (!a || !b || a === b) return; // needs two distinct users
      const entity = await makeEntity(tx);
      await makeStaffWithSalary(tx, entity, 900_000);

      const period = new Date();
      period.setMonth(period.getMonth() - 1); // past month: period is open
      const m = period.getMonth() + 1;
      const y = period.getFullYear();

      const [{ create_payroll_run: run }] = await tx<{ create_payroll_run: string }[]>`
        select public.create_payroll_run(${entity}, ${m}, ${y}, ${a})`;

      // Cannot approve before submission.
      expect(await expectError(tx, (sp) => sp`select public.approve_payroll_run(${run}, ${b})`))
        .toMatch(/submitted/i);

      await tx`select public.submit_payroll_run(${run}, ${a})`;

      // SoD: the preparer cannot approve their own run.
      expect(await expectError(tx, (sp) => sp`select public.approve_payroll_run(${run}, ${a})`))
        .toMatch(/segregation/i);

      await tx`select public.approve_payroll_run(${run}, ${b})`;

      // Accrual JE exists and the run is approved.
      const [r] = await tx<{ status: string; journal_entry_id: string }[]>`
        select status::text, journal_entry_id from public.payroll_runs where id = ${run}`;
      expect(r.status).toBe("approved");
      expect(r.journal_entry_id).toBeTruthy();

      // Two half-salary batches on the 13th and 26th, splitting net 50/50.
      const batches = await tx<{ cycle_no: number; planned_date: string; total_amount: string }[]>`
        select cycle_no, planned_date::text, total_amount::text
        from public.payroll_payment_batches where payroll_run_id = ${run} order by cycle_no`;
      expect(batches.length).toBe(2);
      expect(batches[0].planned_date.endsWith("-13")).toBe(true);
      expect(batches[1].planned_date.endsWith("-26")).toBe(true);

      const [line] = await tx<{ net_amount: string }[]>`
        select net_amount::text from public.payroll_line_items where payroll_run_id = ${run}`;
      const net = Number(line.net_amount);
      expect(Number(batches[0].total_amount) + Number(batches[1].total_amount)).toBeCloseTo(net, 2);
      expect(Number(batches[0].total_amount)).toBeCloseTo(Math.round((net / 2) * 100) / 100, 2);
    });
  });

  it("adjustments flow into the computation (deduction reduces net)", async () => {
    await inRollback(async (tx) => {
      const { a } = await users(tx);
      const entity = await makeEntity(tx);
      const staff = await makeStaffWithSalary(tx, entity, 500_000);
      const period = new Date();
      const m = period.getMonth() + 1;
      const y = period.getFullYear();

      const [{ create_payroll_run: run1 }] = await tx<{ create_payroll_run: string }[]>`
        select public.create_payroll_run(${entity}, ${m}, ${y}, ${a})`;
      const [before] = await tx<{ net_amount: string }[]>`
        select net_amount::text from public.payroll_line_items
        where payroll_run_id = ${run1} and staff_id = ${staff}`;

      await tx`
        insert into public.payroll_adjustments
          (staff_id, period_month, period_year, kind, label, amount, created_by)
        values (${staff}, ${m}, ${y}, 'deduction', 'Co-op loan', 25000, ${a})`;

      await tx`select public.create_payroll_run(${entity}, ${m}, ${y}, ${a})`;
      const [after] = await tx<{ net_amount: string; other_deductions: string }[]>`
        select net_amount::text, other_deductions::text from public.payroll_line_items
        where payroll_run_id = ${run1} and staff_id = ${staff}`;

      expect(Number(after.other_deductions)).toBe(25_000);
      expect(Number(before.net_amount) - Number(after.net_amount)).toBe(25_000);
    });
  });

  it("returned payments reinstate the liability through the ledger", async () => {
    await inRollback(async (tx) => {
      const { a, b } = await users(tx);
      if (!a || !b || a === b) return;
      const entity = await makeEntity(tx);
      await makeStaffWithSalary(tx, entity, 300_000);
      const period = new Date();
      period.setMonth(period.getMonth() - 1);
      const m = period.getMonth() + 1;
      const y = period.getFullYear();

      const [{ create_payroll_run: run }] = await tx<{ create_payroll_run: string }[]>`
        select public.create_payroll_run(${entity}, ${m}, ${y}, ${a})`;
      await tx`select public.submit_payroll_run(${run}, ${a})`;
      await tx`select public.approve_payroll_run(${run}, ${b})`;

      // Push cycle-1 through upload → sign is bank-account specific; take the
      // shortcut of exercising disburse + mark directly at the SQL layer.
      const [batch] = await tx<{ id: string }[]>`
        select id from public.payroll_payment_batches
        where payroll_run_id = ${run} and cycle_no = 1`;
      const [bank] = await tx<{ id: string }[]>`
        insert into public.bank_accounts
          (entity_id, bank_name, account_number_encrypted, account_number_last4, account_purpose, currency)
        values (${entity}, 'Test Bank', '\\x00'::bytea, '0000', 'operations', 'NGN')
        returning id`;
      await tx`select public.mark_payroll_batch_uploaded(${batch.id}, ${bank.id}, 'UP-1', 'TI-1', ${a})`;
      // No signature slots configured for this account → immediately satisfiable.
      await tx`select public.refresh_payroll_batch_status(${batch.id})`;
      const [{ disburse_payroll_batch: je }] = await tx<{ disburse_payroll_batch: string }[]>`
        select public.disburse_payroll_batch(${batch.id}, ${b})`;
      expect(je).toBeTruthy();

      const [payment] = await tx<{ id: string; status: string }[]>`
        select id, status::text from public.payroll_line_payments where batch_id = ${batch.id}`;
      expect(payment.status).toBe("successful");

      await tx`select public.mark_payroll_payment(${payment.id}, 'returned', 'Account closed', ${b})`;
      const [marked] = await tx<{ status: string; correction_journal_entry_id: string }[]>`
        select status::text, correction_journal_entry_id
        from public.payroll_line_payments where id = ${payment.id}`;
      expect(marked.status).toBe("returned");
      expect(marked.correction_journal_entry_id).toBeTruthy();

      // Reissue spawns a fresh pending payment linked back to the original.
      const [{ reissue_payroll_payment: reissued }] = await tx<{ reissue_payroll_payment: string }[]>`
        select public.reissue_payroll_payment(${payment.id}, ${b})`;
      const [np] = await tx<{ status: string; reissue_of: string }[]>`
        select status::text, reissue_of from public.payroll_line_payments where id = ${reissued}`;
      expect(np.status).toBe("pending");
      expect(np.reissue_of).toBe(payment.id);
    });
  });
});
