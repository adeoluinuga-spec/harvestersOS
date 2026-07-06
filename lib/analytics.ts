import "server-only";
import { aiSql, sql } from "./db";
import type { AuthContext } from "./auth";

export type Scope = "all" | string[];
export type AnalyticsRow = Record<string, string | number | boolean | null>;

type QueryAnswer = {
  title: string;
  notes: string;
  sql: string;
  columns: string[];
  rows: AnalyticsRow[];
};

const ANALYTICS_VIEWS = [
  "analytics_giving_monthly",
  "analytics_giving_yoy",
  "analytics_giving_seasonality",
  "analytics_giving_velocity_alerts",
  "analytics_hni_givers",
  "analytics_lapsed_major_givers",
  "analytics_cash_flow_forecast",
  "analytics_expense_anomaly_flags",
  "budget_vs_actual_rollup",
];

const FORBIDDEN_SQL =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|merge|vacuum|refresh|listen|notify)\b/i;

const scoped = (col: string, scope: Scope) =>
  scope === "all"
    ? sql`true`
    : scope.length === 0
      ? sql`false`
      : sql`${sql.unsafe(col)} in ${sql(scope)}`;

export function analyticsScope(ctx: AuthContext): Scope {
  return ctx.isSuperAdmin || ctx.isAuditor ? "all" : ctx.accessibleEntityIds;
}

export async function getAnalyticsDashboard(scope: Scope) {
  const [
    monthly,
    yoy,
    seasonality,
    careAlerts,
    hniGivers,
    lapsedGivers,
    cashFlow,
    expenseFlags,
  ] = await Promise.all([
    sql`
      select * from public.analytics_giving_monthly
      where ${scoped("entity_id", scope)}
      order by month_start desc, total_amount desc
      limit 18`,
    sql`
      select * from public.analytics_giving_yoy
      where ${scoped("entity_id", scope)}
      order by giving_year desc, giving_month desc, total_amount desc
      limit 18`,
    sql`
      select * from public.analytics_giving_seasonality
      where ${scoped("entity_id", scope)}
      order by entity_name, giving_month`,
    sql`
      select * from public.analytics_giving_velocity_alerts
      where ${scoped("entity_id", scope)}
      order by abs(change_percent) desc nulls last
      limit 25`,
    sql`
      select * from public.analytics_hni_givers
      where is_top_percentile and ${scoped("entity_id", scope)}
      order by lifetime_amount desc
      limit 25`,
    sql`
      select * from public.analytics_lapsed_major_givers
      where ${scoped("entity_id", scope)}
      order by lifetime_amount desc
      limit 25`,
    sql`
      select * from public.analytics_cash_flow_forecast
      where ${scoped("entity_id", scope)}
      order by likely_short_before_payroll desc, projected_30_day_net asc
      limit 25`,
    sql`
      select * from public.analytics_expense_anomaly_flags
      where ${scoped("entity_id", scope)}
      order by transaction_date desc, amount desc
      limit 50`,
  ]);

  return {
    monthly: normalizeRows(monthly),
    yoy: normalizeRows(yoy),
    seasonality: normalizeRows(seasonality),
    careAlerts: normalizeRows(careAlerts),
    hniGivers: normalizeRows(hniGivers),
    lapsedGivers: normalizeRows(lapsedGivers),
    cashFlow: normalizeRows(cashFlow),
    expenseFlags: normalizeRows(expenseFlags),
  };
}

export async function answerAnalyticsQuestion(
  question: string,
  ctx: AuthContext
): Promise<QueryAnswer> {
  const prompt = question.trim();
  if (prompt.length < 4) throw new Error("Ask a fuller analytics question.");

  const scope = analyticsScope(ctx);
  try {
    const generated = await generateAnalyticsSql(prompt, scope);
    const rows = await runReadOnlyAnalyticsSql(generated.sql, scope);
    const columns = Object.keys(rows[0] ?? {});

    await logAiQuery({
      userId: ctx.user.id,
      scope,
      prompt,
      generatedSql: generated.sql,
      status: "answered",
      resultPreview: rows.slice(0, 10),
    });

    return {
      title: generated.title || "Analytics answer",
      notes: generated.notes || "",
      sql: generated.sql,
      columns,
      rows,
    };
  } catch (error) {
    await logAiQuery({
      userId: ctx.user.id,
      scope,
      prompt,
      generatedSql: null,
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      resultPreview: null,
    });
    throw error;
  }
}

async function generateAnalyticsSql(prompt: string, scope: Scope) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured for analytics chat.");
  }

  const scopedInstruction =
    scope === "all"
      ? "The requester has global scope."
      : `The requester is limited to these entity ids: ${scope.join(", ")}. Include an allowed_entities CTE and join or filter every entity-scoped view through it.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 1200,
      temperature: 0,
      system: [
        "You generate one read-only PostgreSQL query for Harvesters Finance OS.",
        "Return JSON only with keys: title, notes, sql.",
        "SQL must be a single SELECT or WITH query, no semicolon, no writes, no DDL, no functions that mutate state.",
        "Only query public analytics/reporting views and never auth tables.",
        `Allowed views: ${ANALYTICS_VIEWS.map((v) => `public.${v}`).join(", ")}.`,
        scopedInstruction,
      ].join(" "),
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic request failed: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = payload.content?.find((part) => part.type === "text")?.text;
  if (!text) throw new Error("Anthropic did not return a SQL response.");

  const parsed = JSON.parse(stripJsonFence(text)) as {
    title?: string;
    notes?: string;
    sql?: string;
  };
  if (!parsed.sql) throw new Error("Anthropic response did not include SQL.");

  return {
    title: parsed.title ?? "Analytics answer",
    notes: parsed.notes ?? "",
    sql: parsed.sql.trim(),
  };
}

async function runReadOnlyAnalyticsSql(query: string, scope: Scope) {
  validateAnalyticsSql(query, scope);
  // Runs on the hfos_ai connection: SELECT-only grants on the approved views'
  // closure, forced read-only transactions, 10s statement timeout. The regex
  // validator is a first filter; the database role is the real fence.
  const rows = await aiSql.unsafe(query);
  return normalizeRows(rows).slice(0, 500);
}

function validateAnalyticsSql(query: string, scope: Scope) {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new Error("Analytics AI can only run SELECT or WITH queries.");
  }
  if (trimmed.includes(";")) {
    throw new Error("Analytics AI queries must be a single statement.");
  }
  if (FORBIDDEN_SQL.test(trimmed)) {
    throw new Error("Analytics AI generated a forbidden SQL operation.");
  }
  if (!ANALYTICS_VIEWS.some((view) => lower.includes(view))) {
    throw new Error("Analytics AI must query an approved analytics view.");
  }
  if (/\bauth\./i.test(trimmed)) {
    throw new Error("Analytics AI cannot query authentication tables.");
  }
  if (scope !== "all" && !/\ballowed_entities\b/i.test(trimmed)) {
    throw new Error("Scoped analytics queries must use the allowed_entities CTE.");
  }
}

function normalizeRows(rows: readonly Record<string, unknown>[]): AnalyticsRow[] {
  return rows.map((row) => {
    const normalized: AnalyticsRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = normalizeValue(value);
    }
    return normalized;
  });
}

function normalizeValue(value: unknown): AnalyticsRow[string] {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "bigint") return Number(value);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return JSON.stringify(value);
}

async function logAiQuery(d: {
  userId: string;
  scope: Scope;
  prompt: string;
  generatedSql: string | null;
  resultPreview: AnalyticsRow[] | null;
  status: "answered" | "rejected" | "error";
  errorMessage?: string | null;
}) {
  await sql`
    insert into public.ai_query_logs
      (user_id, entity_scope, prompt, generated_sql, result_preview, status, error_message)
    values
      (${d.userId}, ${d.scope === "all" ? null : d.scope}, ${d.prompt}, ${d.generatedSql},
       ${d.resultPreview ? JSON.stringify(d.resultPreview) : null}::jsonb,
       ${d.status}, ${d.errorMessage ?? null})`;
}

function stripJsonFence(text: string) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}
