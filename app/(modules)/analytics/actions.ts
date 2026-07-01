"use server";

import { requireUser } from "@/lib/auth";
import { answerAnalyticsQuestion, type AnalyticsRow } from "@/lib/analytics";

export type AnalyticsQueryState = {
  ok: boolean;
  error?: string;
  title?: string;
  notes?: string;
  sql?: string;
  columns?: string[];
  rows?: AnalyticsRow[];
};

export async function askAnalyticsAction(
  _prevState: AnalyticsQueryState,
  formData: FormData
): Promise<AnalyticsQueryState> {
  const ctx = await requireUser();
  const question = String(formData.get("question") ?? "").trim();

  try {
    const answer = await answerAnalyticsQuestion(question, ctx);
    return { ok: true, ...answer };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Analytics query failed.",
    };
  }
}
