/* eslint-disable @typescript-eslint/no-explicit-any -- import rows are intentionally dynamic; each commit casts to its own shape */
import "server-only";
import {
  asDate,
  asNumber,
  field,
  perRow,
  resolveEntity,
  type CommitResult,
  type ImportTypeDef,
  type RowError,
  type Validated,
} from "./engine";
import { GIVING_CHANNELS, ACCOUNT_TYPES, FUND_CLASSIFICATIONS } from "@/lib/enums";

const ok = <T>(value: T): Validated<T> => ({ ok: true, value });
const bad = (errors: RowError[]): Validated<never> => ({ ok: false, errors });
const oneOf = (v: string, set: readonly string[]) => set.includes(v);

// ===========================================================================
// GIVERS / CONTACTS
// ===========================================================================
const givers: ImportTypeDef = {
  key: "givers",
  label: "Givers / Contacts",
  description: "Members and givers. De-duplicated on import against existing records.",
  targetTable: "givers",
  entityScoped: false,
  columns: [
    { key: "full_name", label: "full_name", required: true, example: "Ada Obi" },
    { key: "phone", label: "phone", example: "08031234567" },
    { key: "email", label: "email", example: "ada@example.com" },
    { key: "date_of_birth", label: "date_of_birth", help: "YYYY-MM-DD", example: "1990-04-12" },
    { key: "primary_campus", label: "primary_campus", help: "Entity name", example: "Gbagada Campus" },
    { key: "member_id", label: "member_id", help: "Church member number", example: "HIC-00123" },
  ],
  validate: (raw, ctx) => {
    const errors: RowError[] = [];
    const full_name = field(raw, "full_name");
    if (!full_name) errors.push({ field: "full_name", message: "Full name is required" });
    let primary_entity_id: string | null = null;
    const campus = field(raw, "primary_campus");
    if (campus) {
      const e = resolveEntity(ctx, campus);
      if (!e) errors.push({ field: "primary_campus", message: `Unknown/!accessible entity "${campus}"` });
      else primary_entity_id = e.id;
    }
    if (errors.length) return bad(errors);
    return ok({
      full_name,
      phone: field(raw, "phone") || null,
      email: field(raw, "email") || null,
      dob: asDate(field(raw, "date_of_birth")),
      primary_entity_id,
      member_id: field(raw, "member_id") || null,
    });
  },
  commit: (rows, ctx, tx) =>
    perRow(tx, rows as { rowNumber: number; value: any }[], async (v, sp) => {
      const matches = await sp<{ giver_id: string; is_exact: boolean; score: number; reason: string }[]>`
        select * from public.find_giver_matches(${v.full_name}, ${v.phone}, ${v.email}, 3)`;
      const exact = matches.find((m) => m.is_exact);
      const giverId =
        exact?.giver_id ??
        (
          await sp<{ id: string }[]>`
            insert into public.givers (full_name, phone, email, date_of_birth, primary_entity_id)
            values (${v.full_name}, ${v.phone}, ${v.email}, ${v.dob}::date, ${v.primary_entity_id})
            returning id`
        )[0].id;

      // identifiers (idempotent)
      if (v.phone)
        await sp`insert into public.giver_identifiers (giver_id, identifier_type, identifier_value)
                 select ${giverId}, 'phone', public.normalize_phone(${v.phone})
                 where public.normalize_phone(${v.phone}) is not null
                 on conflict do nothing`;
      if (v.email)
        await sp`insert into public.giver_identifiers (giver_id, identifier_type, identifier_value)
                 select ${giverId}, 'email', public.normalize_email(${v.email})
                 where public.normalize_email(${v.email}) is not null
                 on conflict do nothing`;
      if (v.member_id)
        await sp`insert into public.giver_identifiers (giver_id, identifier_type, identifier_value)
                 values (${giverId}, 'member_id', ${v.member_id}) on conflict do nothing`;

      // flag fuzzy (non-exact) duplicates for review
      if (!exact)
        for (const m of matches.filter((x) => !x.is_exact && x.score >= 0.6))
          await sp`insert into public.giver_merge_candidates (giver_id_a, giver_id_b, score, reason)
                   select ${giverId}, ${m.giver_id}, ${m.score}, ${m.reason}
                   where not exists (select 1 from public.giver_merge_candidates
                     where status='pending'
                       and least(giver_id_a,giver_id_b)=least(${giverId}::uuid,${m.giver_id}::uuid)
                       and greatest(giver_id_a,giver_id_b)=greatest(${giverId}::uuid,${m.giver_id}::uuid))`;
      return giverId;
    }),
};

// ===========================================================================
// HISTORICAL GIVING  (posts to the ledger)
// ===========================================================================
const giving_records: ImportTypeDef = {
  key: "giving_records",
  label: "Historical Giving",
  description: "Past giving records. Each row posts a balanced journal entry.",
  targetTable: "giving_records",
  entityScoped: false,
  columns: [
    { key: "giver_name", label: "giver_name", example: "Ada Obi" },
    { key: "giver_phone", label: "giver_phone", example: "08031234567" },
    { key: "giver_email", label: "giver_email" },
    { key: "recording_entity", label: "recording_entity", required: true, help: "Entity that received the gift", example: "Gbagada Campus" },
    { key: "attribution_entity", label: "attribution_entity", help: "Ministry credited (defaults to recording)", example: "Gbagada Campus" },
    { key: "giving_type", label: "giving_type", required: true, help: "tithe|offering|seed|first_fruit|building_fund|missions_pledge|vow|partnership|event_offering", example: "tithe" },
    { key: "amount", label: "amount", required: true, example: "50000" },
    { key: "currency", label: "currency", help: "Defaults to entity currency", example: "NGN" },
    { key: "channel", label: "channel", required: true, help: GIVING_CHANNELS.join("|"), example: "cash" },
    { key: "transaction_date", label: "transaction_date", required: true, example: "2025-01-05" },
    { key: "note", label: "note" },
  ],
  validate: (raw, ctx) => {
    const errors: RowError[] = [];
    const rec = resolveEntity(ctx, field(raw, "recording_entity"));
    if (!rec) errors.push({ field: "recording_entity", message: "Unknown/!accessible recording_entity" });
    const attrRaw = field(raw, "attribution_entity");
    const attr = attrRaw ? resolveEntity(ctx, attrRaw) : rec;
    if (attrRaw && !attr) errors.push({ field: "attribution_entity", message: "Unknown attribution_entity" });
    const gt = ctx.givingTypesByCode.get(field(raw, "giving_type"));
    if (!gt) errors.push({ field: "giving_type", message: "Unknown giving_type code" });
    const amount = asNumber(field(raw, "amount"));
    if (!amount || amount <= 0) errors.push({ field: "amount", message: "Amount must be > 0" });
    const channel = field(raw, "channel");
    if (!oneOf(channel, GIVING_CHANNELS)) errors.push({ field: "channel", message: "Invalid channel" });
    const date = asDate(field(raw, "transaction_date"));
    if (!date) errors.push({ field: "transaction_date", message: "Invalid date" });
    if (errors.length) return bad(errors);
    return ok({
      recId: rec!.id,
      attrId: (attr ?? rec)!.id,
      currency: (field(raw, "currency") || rec!.currency).toUpperCase(),
      givingTypeId: gt!.id,
      amount: String(amount),
      channel,
      date,
      note: field(raw, "note") || null,
      giver_name: field(raw, "giver_name") || null,
      giver_phone: field(raw, "giver_phone") || null,
      giver_email: field(raw, "giver_email") || null,
    });
  },
  commit: (rows, ctx, tx) =>
    perRow(tx, rows as { rowNumber: number; value: any }[], async (v, sp) => {
      let giverId: string | null = null;
      if (v.giver_name || v.giver_phone || v.giver_email) {
        const matches = await sp<{ giver_id: string; is_exact: boolean }[]>`
          select * from public.find_giver_matches(${v.giver_name}, ${v.giver_phone}, ${v.giver_email}, 3)`;
        const exact = matches.find((m) => m.is_exact);
        giverId =
          exact?.giver_id ??
          (v.giver_name
            ? (
                await sp<{ id: string }[]>`
                  insert into public.givers (full_name, phone, email, primary_entity_id)
                  values (${v.giver_name}, ${v.giver_phone}, ${v.giver_email}, ${v.recId}) returning id`
              )[0].id
            : null);
        if (giverId && !exact) {
          if (v.giver_phone)
            await sp`insert into public.giver_identifiers (giver_id, identifier_type, identifier_value)
                     select ${giverId},'phone',public.normalize_phone(${v.giver_phone})
                     where public.normalize_phone(${v.giver_phone}) is not null on conflict do nothing`;
          if (v.giver_email)
            await sp`insert into public.giver_identifiers (giver_id, identifier_type, identifier_value)
                     select ${giverId},'email',public.normalize_email(${v.giver_email})
                     where public.normalize_email(${v.giver_email}) is not null on conflict do nothing`;
        }
      }
      const [gr] = await sp<{ id: string }[]>`
        insert into public.giving_records
          (giver_id, entity_id, recording_entity_id, attribution_entity_id, giving_type_id,
           amount, currency, channel, transaction_date, recorded_by, note)
        values (${giverId}, ${v.recId}, ${v.recId}, ${v.attrId}, ${v.givingTypeId},
                ${v.amount}, ${v.currency}, ${v.channel}::public.giving_channel, ${v.date}::date, ${ctx.actorId}, ${v.note})
        returning id`;
      await sp`select public.post_giving_record(${gr.id})`;
      return gr.id;
    }),
};

// ===========================================================================
// OPENING BALANCES  (grouped -> one balanced JE per entity+date, plug to 3200)
// ===========================================================================
const opening_balances: ImportTypeDef = {
  key: "opening_balances",
  label: "Opening Balances",
  description: "Migrate existing account balances. Posts balanced opening-balance journal entries.",
  targetTable: "journal_entries",
  entityScoped: false,
  columns: [
    { key: "entity", label: "entity", required: true, example: "Gbagada Campus" },
    { key: "account_code", label: "account_code", required: true, example: "1010" },
    { key: "debit", label: "debit", help: "Amount on the debit side", example: "1000000" },
    { key: "credit", label: "credit", help: "Amount on the credit side", example: "" },
    { key: "as_of_date", label: "as_of_date", required: true, example: "2025-12-31" },
  ],
  validate: (raw, ctx) => {
    const errors: RowError[] = [];
    const e = resolveEntity(ctx, field(raw, "entity"));
    if (!e) errors.push({ field: "entity", message: "Unknown/!accessible entity" });
    const acct = ctx.accountsByCode.get(field(raw, "account_code"));
    if (!acct) errors.push({ field: "account_code", message: "Unknown account_code" });
    const debit = asNumber(field(raw, "debit")) ?? 0;
    const credit = asNumber(field(raw, "credit")) ?? 0;
    if (debit < 0 || credit < 0) errors.push({ message: "Amounts cannot be negative" });
    if ((debit > 0) === (credit > 0)) errors.push({ message: "Provide exactly one of debit or credit" });
    const date = asDate(field(raw, "as_of_date"));
    if (!date) errors.push({ field: "as_of_date", message: "Invalid date" });
    if (errors.length) return bad(errors);
    return ok({ entityId: e!.id, currency: e!.currency, accountId: acct!.id, fund: acct!.fund, debit, credit, date });
  },
  commit: async (rows, ctx, tx) => {
    // Group by entity + as_of_date; one balanced JE per group.
    const groups = new Map<string, { rowNumber: number; value: any }[]>();
    for (const r of rows as { rowNumber: number; value: any }[]) {
      const k = `${r.value.entityId}|${r.value.date}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
    }
    const results: CommitResult[] = [];
    const [obe] = await tx<{ id: string }[]>`select id from public.accounts where code='3200'`;
    for (const grp of Array.from(groups.values())) {
      const first = grp[0].value;
      try {
        // @ts-expect-error savepoint
        const jeId = await tx.savepoint(async (sp: Exec) => {
          const [je] = await sp<{ id: string }[]>`
            insert into public.journal_entries (entity_id, transaction_date, description, source_module, created_by, status)
            values (${first.entityId}, ${first.date}::date, 'Opening balance', 'opening_balance', ${ctx.actorId}, 'draft')
            returning id`;
          let net = 0;
          for (const r of grp) {
            await sp`insert into public.journal_entry_lines
              (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
              values (${je.id}, ${r.value.accountId}, ${first.entityId}, ${r.value.debit}, ${r.value.credit},
                      ${r.value.fund}::public.fund_classification, ${first.currency})`;
            net += r.value.debit - r.value.credit;
          }
          // Plug the difference to Opening Balance Equity so the entry balances.
          if (Math.abs(net) > 0.005)
            await sp`insert into public.journal_entry_lines
              (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, fund_classification, currency)
              values (${je.id}, ${obe.id}, ${first.entityId}, ${net < 0 ? -net : 0}, ${net > 0 ? net : 0},
                      'unrestricted', ${first.currency})`;
          await sp`update public.journal_entries set status='posted' where id=${je.id}`;
          return je.id;
        });
        for (const r of grp) results.push({ rowNumber: r.rowNumber, targetId: jeId });
      } catch (e) {
        for (const r of grp) results.push({ rowNumber: r.rowNumber, error: (e as Error).message.split("\n")[0] });
      }
    }
    return results;
  },
};

// ===========================================================================
// BANK STATEMENT  -> bank_feed_transactions (feeds reconciliation)
// ===========================================================================
const bank_statement: ImportTypeDef = {
  key: "bank_statement",
  label: "Bank Statement",
  description: "Statement of account lines for reconciliation matching.",
  targetTable: "bank_feed_transactions",
  entityScoped: true,
  columns: [
    { key: "bank_name", label: "bank_name", required: true, help: "Must match a registered bank account", example: "Guaranty Trust Bank" },
    { key: "transaction_date", label: "transaction_date", required: true, example: "2025-01-05" },
    { key: "amount", label: "amount", required: true, help: "Positive credit, negative debit", example: "50000" },
    { key: "currency", label: "currency", example: "NGN" },
    { key: "description", label: "description", example: "TRF/OFFERING" },
    { key: "external_ref", label: "external_ref", help: "Bank's reference (optional)", example: "GTB-8891" },
  ],
  validate: (raw) => {
    const errors: RowError[] = [];
    if (!field(raw, "bank_name")) errors.push({ field: "bank_name", message: "Required" });
    const amount = asNumber(field(raw, "amount"));
    if (amount == null) errors.push({ field: "amount", message: "Invalid amount" });
    const date = asDate(field(raw, "transaction_date"));
    if (!date) errors.push({ field: "transaction_date", message: "Invalid date" });
    if (errors.length) return bad(errors);
    return ok({
      bankName: field(raw, "bank_name"),
      amount: String(amount),
      date,
      currency: (field(raw, "currency") || "NGN").toUpperCase(),
      description: field(raw, "description") || null,
      externalRef: field(raw, "external_ref") || null,
    });
  },
  commit: (rows, ctx, tx) =>
    perRow(tx, rows as { rowNumber: number; value: any }[], async (v, sp) => {
      const scope = ctx.isSuperAdmin ? null : ctx.accessibleEntityIds;
      const [ba] = await sp<{ id: string }[]>`
        select id from public.bank_accounts
        where lower(bank_name) = lower(${v.bankName})
          ${ctx.batchEntityId ? sp`and entity_id = ${ctx.batchEntityId}` : sp``}
          ${scope ? sp`and entity_id in ${sp(scope)}` : sp``}
        limit 1`;
      if (!ba) throw new Error(`No accessible bank account named "${v.bankName}"`);
      const ext = v.externalRef ?? `manual-${v.date}-${v.amount}-${v.description ?? ""}`.slice(0, 120);
      const [row] = await sp<{ id: string }[]>`
        insert into public.bank_feed_transactions
          (bank_account_id, provider, external_transaction_id, transaction_date, amount, currency, description)
        values (${ba.id}, 'manual', ${ext}, ${v.date}::date, ${v.amount}, ${v.currency}, ${v.description})
        returning id`;
      return row.id;
    }),
};

// ===========================================================================
// CHART OF ACCOUNTS
// ===========================================================================
const chart_of_accounts: ImportTypeDef = {
  key: "chart_of_accounts",
  label: "Chart of Accounts",
  description: "Load or extend the global chart of accounts.",
  targetTable: "accounts",
  entityScoped: false,
  columns: [
    { key: "code", label: "code", required: true, example: "4050" },
    { key: "name", label: "name", required: true, example: "Missions Giving" },
    { key: "account_type", label: "account_type", required: true, help: ACCOUNT_TYPES.join("|"), example: "income" },
    { key: "fund_classification", label: "fund_classification", help: FUND_CLASSIFICATIONS.join("|"), example: "unrestricted" },
  ],
  validate: (raw) => {
    const errors: RowError[] = [];
    if (!field(raw, "code")) errors.push({ field: "code", message: "Required" });
    if (!field(raw, "name")) errors.push({ field: "name", message: "Required" });
    if (!oneOf(field(raw, "account_type"), ACCOUNT_TYPES)) errors.push({ field: "account_type", message: "Invalid" });
    const fund = field(raw, "fund_classification") || "unrestricted";
    if (!oneOf(fund, FUND_CLASSIFICATIONS)) errors.push({ field: "fund_classification", message: "Invalid" });
    if (errors.length) return bad(errors);
    return ok({ code: field(raw, "code"), name: field(raw, "name"), type: field(raw, "account_type"), fund });
  },
  commit: (rows, _ctx, tx) =>
    perRow(tx, rows as { rowNumber: number; value: any }[], async (v, sp) => {
      const [a] = await sp<{ id: string }[]>`
        insert into public.accounts (code, name, account_type, fund_classification)
        values (${v.code}, ${v.name}, ${v.type}::public.account_type, ${v.fund}::public.fund_classification)
        on conflict (code) do nothing returning id`;
      if (!a) throw new Error(`Account code ${v.code} already exists (skipped)`);
      return a.id;
    }),
};

// ===========================================================================
// Simple entity-scoped inserts (vendors, pledges, fx, investments, funds, ...)
// ===========================================================================
const vendors: ImportTypeDef = {
  key: "vendors",
  label: "Vendors",
  description: "Vendor master. Account numbers are encrypted at rest on import.",
  targetTable: "vendors",
  entityScoped: false,
  columns: [
    { key: "name", label: "name", required: true, example: "Zenith Prints Ltd" },
    { key: "bank_account_number", label: "bank_account_number", required: true, example: "0123456789" },
    { key: "tax_id", label: "tax_id", example: "TIN-99001" },
    { key: "is_related_party", label: "is_related_party", help: "yes/no", example: "no" },
  ],
  validate: (raw) => {
    const errors: RowError[] = [];
    if (!field(raw, "name")) errors.push({ field: "name", message: "Required" });
    if (!field(raw, "bank_account_number")) errors.push({ field: "bank_account_number", message: "Required" });
    if (errors.length) return bad(errors);
    return ok({
      name: field(raw, "name"),
      acct: field(raw, "bank_account_number"),
      tax: field(raw, "tax_id") || null,
      related: /^(y|yes|true|1)$/i.test(field(raw, "is_related_party")),
    });
  },
  commit: (rows, _ctx, tx) =>
    perRow(tx, rows as { rowNumber: number; value: any }[], async (v, sp) => {
      const [row] = await sp<{ id: string }[]>`
        insert into public.vendors (name, bank_account_number_encrypted, bank_account_number_last4, tax_id, is_related_party)
        values (${v.name}, public.encrypt_account_number(${v.acct}),
                right(regexp_replace(${v.acct}, '\\D', '', 'g'), 4), ${v.tax}, ${v.related})
        returning id`;
      return row.id;
    }),
};

const pledges: ImportTypeDef = {
  key: "pledges",
  label: "Pledges / Vows",
  description: "Outstanding pledges as receivables.",
  targetTable: "pledges",
  entityScoped: false,
  columns: [
    { key: "giver_name", label: "giver_name", required: true, example: "Ada Obi" },
    { key: "giver_phone", label: "giver_phone", example: "08031234567" },
    { key: "entity", label: "entity", required: true, example: "Gbagada Campus" },
    { key: "pledge_type", label: "pledge_type", required: true, help: "building_fund|missions|vow", example: "building_fund" },
    { key: "total_pledged_amount", label: "total_pledged_amount", required: true, example: "500000" },
    { key: "currency", label: "currency", example: "NGN" },
    { key: "start_date", label: "start_date", example: "2025-01-01" },
    { key: "target_fulfillment_date", label: "target_fulfillment_date", example: "2025-12-31" },
  ],
  validate: (raw, ctx) => {
    const errors: RowError[] = [];
    if (!field(raw, "giver_name")) errors.push({ field: "giver_name", message: "Required" });
    const e = resolveEntity(ctx, field(raw, "entity"));
    if (!e) errors.push({ field: "entity", message: "Unknown/!accessible entity" });
    const total = asNumber(field(raw, "total_pledged_amount"));
    if (!total || total <= 0) errors.push({ field: "total_pledged_amount", message: "Must be > 0" });
    if (errors.length) return bad(errors);
    return ok({
      giver_name: field(raw, "giver_name"),
      giver_phone: field(raw, "giver_phone") || null,
      entityId: e!.id,
      currency: (field(raw, "currency") || e!.currency).toUpperCase(),
      pledge_type: field(raw, "pledge_type"),
      total: String(total),
      start: asDate(field(raw, "start_date")),
      target: asDate(field(raw, "target_fulfillment_date")),
    });
  },
  commit: (rows, ctx, tx) =>
    perRow(tx, rows as { rowNumber: number; value: any }[], async (v, sp) => {
      const matches = await sp<{ giver_id: string; is_exact: boolean }[]>`
        select * from public.find_giver_matches(${v.giver_name}, ${v.giver_phone}, null, 3)`;
      const giverId =
        matches.find((m) => m.is_exact)?.giver_id ??
        (await sp<{ id: string }[]>`
          insert into public.givers (full_name, phone, primary_entity_id)
          values (${v.giver_name}, ${v.giver_phone}, ${v.entityId}) returning id`)[0].id;
      const [row] = await sp<{ id: string }[]>`
        insert into public.pledges
          (giver_id, entity_id, pledge_type, total_pledged_amount, currency, start_date, target_fulfillment_date)
        values (${giverId}, ${v.entityId}, ${v.pledge_type}::public.pledge_type, ${v.total}, ${v.currency},
                coalesce(${v.start}::date, current_date), ${v.target}::date)
        returning id`;
      return row.id;
    }),
};

const fx_rates: ImportTypeDef = {
  key: "fx_rates",
  label: "FX Rates",
  description: "Historical exchange rates for consolidation.",
  targetTable: "fx_rates",
  entityScoped: false,
  columns: [
    { key: "currency_pair", label: "currency_pair", required: true, help: "e.g. USD/NGN", example: "USD/NGN" },
    { key: "rate", label: "rate", required: true, example: "1650.50" },
    { key: "effective_date", label: "effective_date", required: true, example: "2025-01-01" },
    { key: "source", label: "source", example: "CBN" },
  ],
  validate: (raw) => {
    const errors: RowError[] = [];
    if (!/^[A-Za-z]{3}\/[A-Za-z]{3}$/.test(field(raw, "currency_pair")))
      errors.push({ field: "currency_pair", message: "Use format XXX/YYY" });
    const rate = asNumber(field(raw, "rate"));
    if (!rate || rate <= 0) errors.push({ field: "rate", message: "Must be > 0" });
    const date = asDate(field(raw, "effective_date"));
    if (!date) errors.push({ field: "effective_date", message: "Invalid date" });
    if (errors.length) return bad(errors);
    return ok({ pair: field(raw, "currency_pair").toUpperCase(), rate: String(rate), date, source: field(raw, "source") || "import" });
  },
  commit: (rows, ctx, tx) =>
    perRow(tx, rows as { rowNumber: number; value: any }[], async (v, sp) => {
      const [row] = await sp<{ id: string }[]>`
        insert into public.fx_rates (currency_pair, rate, effective_date, source, created_by)
        values (${v.pair}, ${v.rate}, ${v.date}::date, ${v.source}, ${ctx.actorId}) returning id`;
      return row.id;
    }),
};

const investments: ImportTypeDef = {
  key: "investments",
  label: "Investments",
  description: "Fixed deposits, treasury bills and other instruments.",
  targetTable: "investments",
  entityScoped: false,
  columns: [
    { key: "entity", label: "entity", required: true, example: "Harvesters Nigeria" },
    { key: "investment_type", label: "investment_type", required: true, help: "e.g. fixed_deposit|treasury_bill", example: "fixed_deposit" },
    { key: "institution", label: "institution", required: true, example: "Zenith Bank" },
    { key: "principal_amount", label: "principal_amount", required: true, example: "10000000" },
    { key: "currency", label: "currency", example: "NGN" },
    { key: "interest_rate", label: "interest_rate", example: "18.5" },
    { key: "start_date", label: "start_date", required: true, example: "2025-01-01" },
    { key: "maturity_date", label: "maturity_date", required: true, example: "2025-07-01" },
  ],
  validate: (raw, ctx) => {
    const errors: RowError[] = [];
    const e = resolveEntity(ctx, field(raw, "entity"));
    if (!e) errors.push({ field: "entity", message: "Unknown/!accessible entity" });
    if (!field(raw, "institution")) errors.push({ field: "institution", message: "Required" });
    const principal = asNumber(field(raw, "principal_amount"));
    if (!principal || principal <= 0) errors.push({ field: "principal_amount", message: "Must be > 0" });
    const start = asDate(field(raw, "start_date"));
    const maturity = asDate(field(raw, "maturity_date"));
    if (!start) errors.push({ field: "start_date", message: "Invalid date" });
    if (!maturity) errors.push({ field: "maturity_date", message: "Invalid date" });
    if (errors.length) return bad(errors);
    return ok({
      entityId: e!.id,
      type: field(raw, "investment_type"),
      institution: field(raw, "institution"),
      principal: String(principal),
      currency: (field(raw, "currency") || e!.currency).toUpperCase(),
      rate: asNumber(field(raw, "interest_rate")),
      start,
      maturity,
    });
  },
  commit: (rows, ctx, tx) =>
    perRow(tx, rows as { rowNumber: number; value: any }[], async (v, sp) => {
      const [row] = await sp<{ id: string }[]>`
        insert into public.investments
          (entity_id, investment_type, institution, principal_amount, currency, interest_rate, start_date, maturity_date, created_by)
        values (${v.entityId}, ${v.type}::public.investment_type, ${v.institution}, ${v.principal}, ${v.currency},
                ${v.rate}, ${v.start}::date, ${v.maturity}::date, ${ctx.actorId})
        returning id`;
      return row.id;
    }),
};

const staff: ImportTypeDef = {
  key: "staff",
  label: "Staff",
  description: "Staff registry (compensation is set per staff after import).",
  targetTable: "staff",
  entityScoped: false,
  columns: [
    { key: "entity", label: "entity", required: true, example: "Gbagada Campus" },
    { key: "full_name", label: "full_name", required: true, example: "John Musa" },
    { key: "staff_type", label: "staff_type", required: true, help: "minister_clergy|administrative", example: "administrative" },
    { key: "employment_status", label: "employment_status", help: "e.g. active", example: "active" },
    { key: "state_of_taxation", label: "state_of_taxation", example: "Lagos" },
    { key: "pfa_provider", label: "pfa_provider", example: "Stanbic IBTC Pension" },
    { key: "pension_id", label: "pension_id", example: "PEN123456" },
  ],
  validate: (raw, ctx) => {
    const errors: RowError[] = [];
    const e = resolveEntity(ctx, field(raw, "entity"));
    if (!e) errors.push({ field: "entity", message: "Unknown/!accessible entity" });
    if (!field(raw, "full_name")) errors.push({ field: "full_name", message: "Required" });
    if (!field(raw, "staff_type")) errors.push({ field: "staff_type", message: "Required" });
    if (errors.length) return bad(errors);
    return ok({
      entityId: e!.id,
      full_name: field(raw, "full_name"),
      staff_type: field(raw, "staff_type"),
      employment_status: field(raw, "employment_status") || null,
      state: field(raw, "state_of_taxation") || null,
      pfa: field(raw, "pfa_provider") || null,
      pension: field(raw, "pension_id") || null,
    });
  },
  commit: (rows, _ctx, tx) =>
    perRow(tx, rows as { rowNumber: number; value: any }[], async (v, sp) => {
      const [row] = await sp<{ id: string }[]>`
        insert into public.staff (entity_id, full_name, staff_type, employment_status, state_of_taxation, pfa_provider, pension_id)
        values (${v.entityId}, ${v.full_name}, ${v.staff_type}::public.staff_type,
                ${v.employment_status ? sp`${v.employment_status}::public.employment_status` : sp`default`},
                ${v.state}, ${v.pfa}, ${v.pension})
        returning id`;
      return row.id;
    }),
};

const restricted_funds: ImportTypeDef = {
  key: "restricted_funds",
  label: "Restricted Funds",
  description: "Named restricted funds with targets.",
  targetTable: "restricted_funds",
  entityScoped: false,
  columns: [
    { key: "entity", label: "entity", required: true, example: "Gbagada Campus" },
    { key: "name", label: "name", required: true, example: "New Auditorium Fund" },
    { key: "fund_classification", label: "fund_classification", required: true, help: FUND_CLASSIFICATIONS.join("|"), example: "temporarily_restricted" },
    { key: "target_amount", label: "target_amount", example: "50000000" },
    { key: "purpose_description", label: "purpose_description", example: "Construction of new auditorium" },
  ],
  validate: (raw, ctx) => {
    const errors: RowError[] = [];
    const e = resolveEntity(ctx, field(raw, "entity"));
    if (!e) errors.push({ field: "entity", message: "Unknown/!accessible entity" });
    if (!field(raw, "name")) errors.push({ field: "name", message: "Required" });
    if (!oneOf(field(raw, "fund_classification"), FUND_CLASSIFICATIONS))
      errors.push({ field: "fund_classification", message: "Invalid" });
    if (errors.length) return bad(errors);
    return ok({
      entityId: e!.id,
      name: field(raw, "name"),
      fund: field(raw, "fund_classification"),
      target: asNumber(field(raw, "target_amount")),
      purpose: field(raw, "purpose_description") || null,
    });
  },
  commit: (rows, _ctx, tx) =>
    perRow(tx, rows as { rowNumber: number; value: any }[], async (v, sp) => {
      const [row] = await sp<{ id: string }[]>`
        insert into public.restricted_funds (entity_id, name, fund_classification, target_amount, purpose_description)
        values (${v.entityId}, ${v.name}, ${v.fund}::public.fund_classification, ${v.target}, ${v.purpose})
        returning id`;
      return row.id;
    }),
};

const entities: ImportTypeDef = {
  key: "entities",
  label: "Entities / Campuses",
  description: "Bulk-create campuses and units under an existing parent.",
  targetTable: "entities",
  entityScoped: false,
  columns: [
    { key: "type", label: "type", required: true, help: "group|sub_group|campus|ministry_expression|ministry_directorate", example: "campus" },
    { key: "parent_entity", label: "parent_entity", required: true, example: "Harvesters Nigeria" },
    { key: "name", label: "name", required: true, example: "Yaba Campus" },
    { key: "country", label: "country", example: "NG" },
    { key: "functional_currency", label: "functional_currency", required: true, example: "NGN" },
    { key: "legal_status", label: "legal_status", help: "incorporated_trustee|separate_foreign_entity|unincorporated_unit", example: "unincorporated_unit" },
  ],
  validate: (raw, ctx) => {
    const errors: RowError[] = [];
    if (!field(raw, "type")) errors.push({ field: "type", message: "Required" });
    if (!field(raw, "name")) errors.push({ field: "name", message: "Required" });
    const parent = resolveEntity(ctx, field(raw, "parent_entity"));
    if (!parent) errors.push({ field: "parent_entity", message: "Unknown/!accessible parent" });
    const ccy = field(raw, "functional_currency").toUpperCase();
    if (ccy.length !== 3) errors.push({ field: "functional_currency", message: "3-letter ISO code" });
    if (errors.length) return bad(errors);
    return ok({
      type: field(raw, "type"),
      parentId: parent!.id,
      name: field(raw, "name"),
      country: field(raw, "country") || null,
      ccy,
      legal: field(raw, "legal_status") || null,
    });
  },
  commit: (rows, _ctx, tx) =>
    perRow(tx, rows as { rowNumber: number; value: any }[], async (v, sp) => {
      const [row] = await sp<{ id: string }[]>`
        insert into public.entities (type, parent_entity_id, name, country, functional_currency, legal_status)
        values (${v.type}::public.entity_type, ${v.parentId}, ${v.name}, ${v.country}, ${v.ccy},
                ${v.legal ? sp`${v.legal}::public.legal_status` : sp`null`})
        returning id`;
      return row.id;
    }),
};

// ===========================================================================
export const IMPORT_TYPES: Record<string, ImportTypeDef> = {
  givers,
  giving_records,
  opening_balances,
  bank_statement,
  chart_of_accounts,
  vendors,
  pledges,
  fx_rates,
  investments,
  staff,
  restricted_funds,
  entities,
};

export const IMPORT_TYPE_LIST = Object.values(IMPORT_TYPES);
export const getImportDef = (key: string): ImportTypeDef | undefined => IMPORT_TYPES[key];
