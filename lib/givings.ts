import "server-only";
import { sql, type Exec } from "./db";

// ---------------------------------------------------------------------------
// Scope helper — build a WHERE fragment restricting to accessible entities.
// ---------------------------------------------------------------------------
type Scope = "all" | string[];
const scoped = (col: string, scope: Scope) =>
  scope === "all"
    ? sql`true`
    : scope.length === 0
      ? sql`false`
      : sql`${sql.unsafe(col)} in ${sql(scope)}`;

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
export type GivingType = {
  id: string;
  code: string;
  name: string;
  default_fund_classification: string;
};
export async function getGivingTypes(): Promise<GivingType[]> {
  return sql<GivingType[]>`
    select id, code, name, default_fund_classification
    from public.giving_types where is_active order by sort_order, name`;
}

// ---------------------------------------------------------------------------
// Givers
// ---------------------------------------------------------------------------
export type GiverRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  primary_entity_id: string | null;
  is_active: boolean;
};

export async function searchGivers(q: string): Promise<GiverRow[]> {
  const like = `%${q}%`;
  return sql<GiverRow[]>`
    select id, full_name, phone, email, primary_entity_id, is_active
    from public.givers
    where is_active and (${q} = '' or full_name ilike ${like}
                         or phone ilike ${like} or email ilike ${like})
    order by full_name limit 50`;
}

export async function getGiver(id: string): Promise<GiverRow | null> {
  const [g] = await sql<GiverRow[]>`
    select id, full_name, phone, email, primary_entity_id, is_active
    from public.givers where id = ${id}`;
  return g ?? null;
}

export type GivingHistoryRow = {
  id: string;
  transaction_date: string;
  type_name: string;
  entity_name: string;
  recording_entity_name: string;
  attribution_entity_name: string;
  amount: string;
  currency: string;
  channel: string;
  reconciliation_status: string;
};
export async function getGiverHistory(id: string): Promise<GivingHistoryRow[]> {
  return sql<GivingHistoryRow[]>`
    select gr.id, gr.transaction_date, gt.name as type_name, e.name as entity_name,
           rec.name as recording_entity_name, attr.name as attribution_entity_name,
           gr.amount, gr.currency, gr.channel, gr.reconciliation_status
    from public.giving_records gr
    join public.giving_types gt on gt.id = gr.giving_type_id
    join public.entities e on e.id = gr.entity_id
    join public.entities rec on rec.id = gr.recording_entity_id
    join public.entities attr on attr.id = gr.attribution_entity_id
    where gr.giver_id = ${id}
    order by gr.transaction_date desc, gr.created_at desc`;
}

export async function getGiverTotals(id: string) {
  const [byType, byEntity, grand] = await Promise.all([
    sql`select gt.name, gr.currency, sum(gr.amount) as total
        from public.giving_records gr join public.giving_types gt on gt.id = gr.giving_type_id
        where gr.giver_id = ${id} group by gt.name, gr.currency order by total desc`,
    sql`select e.name, gr.currency, sum(gr.amount) as total
        from public.giving_records gr join public.entities e on e.id = gr.attribution_entity_id
        where gr.giver_id = ${id} group by e.name, gr.currency order by total desc`,
    sql`select gr.currency, sum(gr.amount) as total, count(*)::int as n
        from public.giving_records gr where gr.giver_id = ${id} group by gr.currency`,
  ]);
  return { byType, byEntity, grand };
}

// ---------------------------------------------------------------------------
// Recent givings + summary (dashboard)
// ---------------------------------------------------------------------------
export async function getRecentGivings(scope: Scope, limit = 25) {
  const filter =
    scope === "all"
      ? sql`true`
      : scope.length === 0
        ? sql`false`
        : sql`(gr.recording_entity_id in ${sql(scope)} or gr.attribution_entity_id in ${sql(scope)})`;
  return sql`
    select gr.id, gr.transaction_date, coalesce(gv.full_name, 'Anonymous') as giver,
           gt.name as type, rec.name as recording_entity, attr.name as attribution_entity,
           attr.name as entity, gr.amount, gr.currency, gr.channel
    from public.giving_records gr
    left join public.givers gv on gv.id = gr.giver_id
    join public.giving_types gt on gt.id = gr.giving_type_id
    join public.entities rec on rec.id = gr.recording_entity_id
    join public.entities attr on attr.id = gr.attribution_entity_id
    where ${filter}
    order by gr.created_at desc limit ${limit}`;
}

export async function getGivingSummary(scope: Scope) {
  const grFilter =
    scope === "all"
      ? sql`true`
      : scope.length === 0
        ? sql`false`
        : sql`(gr.recording_entity_id in ${sql(scope)} or gr.attribution_entity_id in ${sql(scope)})`;
  const [totals, givers, dupes, pledges] = await Promise.all([
    sql`select gr.currency, sum(gr.amount) as total, count(*)::int as n
        from public.giving_records gr
        where ${grFilter}
          and date_trunc('year', gr.transaction_date) = date_trunc('year', current_date)
        group by gr.currency`,
    sql`select count(distinct gr.giver_id)::int as n from public.giving_records gr
        where ${grFilter}`,
    sql`select count(*)::int as n from public.giver_merge_candidates where status = 'pending'`,
    sql`select count(*)::int as n from public.pledges p
        where p.status = 'active' and ${scoped("p.entity_id", scope)}`,
  ]);
  return {
    totals,
    givers: givers[0]?.n ?? 0,
    pendingDuplicates: dupes[0]?.n ?? 0,
    activePledges: pledges[0]?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Duplicate review queue
// ---------------------------------------------------------------------------
export async function getMergeQueue() {
  return sql`
    select mc.id, mc.score, mc.reason, mc.detected_at,
           a.id as a_id, a.full_name as a_name, a.phone as a_phone, a.email as a_email,
           b.id as b_id, b.full_name as b_name, b.phone as b_phone, b.email as b_email,
           (select count(*)::int from public.giving_records where giver_id = a.id) as a_gifts,
           (select count(*)::int from public.giving_records where giver_id = b.id) as b_gifts
    from public.giver_merge_candidates mc
    join public.givers a on a.id = mc.giver_id_a
    join public.givers b on b.id = mc.giver_id_b
    where mc.status = 'pending'
    order by mc.score desc, mc.detected_at desc`;
}

// ---------------------------------------------------------------------------
// Pledges + aging
// ---------------------------------------------------------------------------
export async function getPledgeAging(scope: Scope) {
  return sql`
    select pa.pledge_id, pa.entity_id, pa.entity_name, pa.giver_name, pa.pledge_type, pa.currency,
           pa.total_pledged_amount, pa.fulfilled_amount, pa.outstanding_amount,
           pa.target_fulfillment_date, pa.status, pa.aging_bucket
    from public.pledge_aging pa
    where ${scoped("pa.entity_id", scope)}
    order by
      case pa.aging_bucket when '90+' then 0 when '61-90' then 1 when '31-60' then 2
                           when '1-30' then 3 when 'current' then 4 when 'no_due_date' then 5
                           else 6 end,
      pa.outstanding_amount desc`;
}

export type PledgeInput = {
  giver_id: string;
  entity_id: string;
  pledge_type: string;
  total_pledged_amount: string;
  currency: string;
  target_fulfillment_date: string | null;
};
export async function insertPledge(d: PledgeInput, exec: Exec = sql): Promise<void> {
  await exec`
    insert into public.pledges
      (giver_id, entity_id, pledge_type, total_pledged_amount, currency, target_fulfillment_date)
    values (${d.giver_id}, ${d.entity_id}, ${d.pledge_type}::public.pledge_type,
            ${d.total_pledged_amount}, ${d.currency}, ${d.target_fulfillment_date}::date)`;
}

export type PledgeForPayment = {
  id: string;
  entity_id: string;
  giver_id: string;
  currency: string;
  pledge_type: string;
};
export async function getPledge(id: string): Promise<PledgeForPayment | null> {
  const [p] = await sql<PledgeForPayment[]>`
    select id, entity_id, giver_id, currency, pledge_type from public.pledges where id = ${id}`;
  return p ?? null;
}

export async function getGivingTypeIdByCode(code: string): Promise<string | null> {
  const [t] = await sql<{ id: string }[]>`
    select id from public.giving_types where code = ${code}`;
  return t?.id ?? null;
}

export async function getActivePledgesForGiver(giverId: string, entityId: string) {
  return sql`
    select p.id, p.pledge_type, b.outstanding_amount, p.currency
    from public.pledges p join public.pledge_balances b on b.id = p.id
    where p.giver_id = ${giverId} and p.entity_id = ${entityId}
      and p.status = 'active' and b.outstanding_amount > 0
    order by p.created_at`;
}

// ---------------------------------------------------------------------------
// Giver resolution + record giving (posts to the ledger)
// ---------------------------------------------------------------------------
const FLAG_THRESHOLD = 0.6;

type ResolveInput =
  | { mode: "existing"; giverId: string }
  | { mode: "anonymous" }
  | {
      mode: "new";
      name: string;
      phone: string | null;
      email: string | null;
      dob: string | null;
      entityId: string;
    };

export type FlaggedMatch = { name: string; score: number; reason: string };

async function ensureIdentifiers(
  tx: Exec,
  giverId: string,
  phone: string | null,
  email: string | null,
  entityId: string
) {
  if (phone)
    await tx`
      insert into public.giver_identifiers (giver_id, identifier_type, identifier_value, entity_id_recorded_at)
      select ${giverId}, 'phone', public.normalize_phone(${phone}), ${entityId}
      where public.normalize_phone(${phone}) is not null
      on conflict (giver_id, identifier_type, identifier_value) do nothing`;
  if (email)
    await tx`
      insert into public.giver_identifiers (giver_id, identifier_type, identifier_value, entity_id_recorded_at)
      select ${giverId}, 'email', public.normalize_email(${email}), ${entityId}
      where public.normalize_email(${email}) is not null
      on conflict (giver_id, identifier_type, identifier_value) do nothing`;
}

async function resolveGiver(
  tx: Exec,
  input: ResolveInput
): Promise<{ giverId: string | null; flagged: FlaggedMatch[] }> {
  if (input.mode === "existing") return { giverId: input.giverId, flagged: [] };
  if (input.mode === "anonymous") return { giverId: null, flagged: [] };

  const { name, phone, email, dob, entityId } = input;
  const matches = await tx<
    { giver_id: string; full_name: string; score: number; reason: string; is_exact: boolean }[]
  >`select * from public.find_giver_matches(${name}, ${phone}, ${email}, 5)`;

  const exact = matches.find((m) => m.is_exact);
  if (exact) {
    await ensureIdentifiers(tx, exact.giver_id, phone, email, entityId);
    return { giverId: exact.giver_id, flagged: [] };
  }

  const [g] = await tx<{ id: string }[]>`
    insert into public.givers (full_name, phone, email, date_of_birth, primary_entity_id)
    values (${name}, ${phone}, ${email}, ${dob}::date, ${entityId}) returning id`;
  await ensureIdentifiers(tx, g.id, phone, email, entityId);

  const flagged = matches.filter((m) => !m.is_exact && m.score >= FLAG_THRESHOLD);
  for (const c of flagged) {
    await tx`
      insert into public.giver_merge_candidates (giver_id_a, giver_id_b, score, reason)
      select ${g.id}, ${c.giver_id}, ${c.score}, ${c.reason}
      where not exists (
        select 1 from public.giver_merge_candidates
        where status = 'pending'
          and least(giver_id_a, giver_id_b) = least(${g.id}::uuid, ${c.giver_id}::uuid)
          and greatest(giver_id_a, giver_id_b) = greatest(${g.id}::uuid, ${c.giver_id}::uuid))`;
  }
  return {
    giverId: g.id,
    flagged: flagged.map((f) => ({ name: f.full_name, score: f.score, reason: f.reason })),
  };
}

export type RecordGivingInput = {
  resolve: ResolveInput;
  entityId: string;
  recordingEntityId?: string;
  attributionEntityId?: string;
  givingTypeId: string;
  amount: string;
  currency: string;
  channel: string;
  transactionDate: string;
  note: string | null;
  pledgeId: string | null;
};

export async function recordGiving(
  tx: Exec,
  input: RecordGivingInput,
  actorId: string
): Promise<{ grId: string; je: string; giverId: string | null; flagged: FlaggedMatch[] }> {
  const { giverId, flagged } = await resolveGiver(tx, input.resolve);
  const recordingEntityId = input.recordingEntityId ?? input.entityId;
  const attributionEntityId = input.attributionEntityId ?? input.entityId;

  const [gr] = await tx<{ id: string }[]>`
    insert into public.giving_records
      (giver_id, entity_id, recording_entity_id, attribution_entity_id, giving_type_id,
       amount, currency, channel, transaction_date, recorded_by, note)
    values (${giverId}, ${recordingEntityId}, ${recordingEntityId}, ${attributionEntityId},
            ${input.givingTypeId}, ${input.amount}, ${input.currency},
            ${input.channel}::public.giving_channel, ${input.transactionDate}::date, ${actorId}, ${input.note})
    returning id`;

  const [{ post_giving_record: je }] = await tx<{ post_giving_record: string }[]>`
    select public.post_giving_record(${gr.id})`;

  if (input.pledgeId)
    await tx`
      insert into public.pledge_fulfillments (pledge_id, giving_record_id, amount)
      values (${input.pledgeId}, ${gr.id}, ${input.amount})`;

  return { grId: gr.id, je, giverId, flagged };
}

// ---------------------------------------------------------------------------
// Merge / dismiss duplicates
// ---------------------------------------------------------------------------
export async function mergeGivers(
  keep: string,
  merge: string,
  actor: string,
  exec: Exec = sql
): Promise<void> {
  await exec`select public.merge_givers(${keep}, ${merge}, ${actor})`;
}

export async function dismissMergeCandidate(
  id: string,
  actor: string,
  exec: Exec = sql
): Promise<void> {
  await exec`
    update public.giver_merge_candidates
       set status = 'dismissed', resolved_by = ${actor}, resolved_at = now()
     where id = ${id} and status = 'pending'`;
}

// ---------------------------------------------------------------------------
// Giving statement (per giver, per year) — PDF-ready data
// ---------------------------------------------------------------------------
export async function getGivingStatement(giverId: string, year: number) {
  const [giver, byType, byEntity, transactions, grand] = await Promise.all([
    getGiver(giverId),
    sql`select gt.name, gr.currency, sum(gr.amount) as total
        from public.giving_records gr join public.giving_types gt on gt.id = gr.giving_type_id
        where gr.giver_id = ${giverId} and extract(year from gr.transaction_date) = ${year}
        group by gt.name, gr.currency order by total desc`,
    sql`select e.name, gr.currency, sum(gr.amount) as total
        from public.giving_records gr join public.entities e on e.id = gr.attribution_entity_id
        where gr.giver_id = ${giverId} and extract(year from gr.transaction_date) = ${year}
        group by e.name, gr.currency order by total desc`,
    sql`select gr.transaction_date, gt.name as type_name, e.name as entity_name,
               gr.channel, gr.amount, gr.currency
        from public.giving_records gr
        join public.giving_types gt on gt.id = gr.giving_type_id
        join public.entities e on e.id = gr.attribution_entity_id
        where gr.giver_id = ${giverId} and extract(year from gr.transaction_date) = ${year}
        order by gr.transaction_date`,
    sql`select gr.currency, sum(gr.amount) as total, count(*)::int as n
        from public.giving_records gr
        where gr.giver_id = ${giverId} and extract(year from gr.transaction_date) = ${year}
        group by gr.currency`,
  ]);
  return { giver, byType, byEntity, transactions, grand, year };
}
