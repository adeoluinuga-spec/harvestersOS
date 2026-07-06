"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui";
import { humanize } from "@/lib/enums";
import { money } from "@/lib/format";
import { decideApprovalDirect } from "../actions";

export type ApprovalItem = {
  id: string;
  title: string;
  subject_type: string;
  approver_role: string;
  sequence_order: number;
  entity_name: string;
  amount: string;
  currency: string;
  is_urgent: boolean;
  is_board_step: boolean;
};

type RowState = { status: "idle" | "deciding" | "done" | "error"; decision?: string; error?: string };

/**
 * Optimistic approvals: the row leaves the queue the instant you decide;
 * if the server disagrees (SoD, MFA step-up, someone beat you to it) the row
 * comes back with the reason. No page reloads between decisions.
 */
export function ApprovalsQueue({ items }: { items: ApprovalItem[] }) {
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  function decide(id: string, decision: "approved" | "rejected") {
    setStates((s) => ({ ...s, [id]: { status: "deciding", decision } }));
    startTransition(async () => {
      const res = await decideApprovalDirect({
        approvalId: id,
        decision,
        comments: comments[id]?.trim() || null,
      });
      setStates((s) => ({
        ...s,
        [id]: res.ok
          ? { status: "done", decision }
          : { status: "error", error: res.error ?? "The decision was not accepted." },
      }));
    });
  }

  const visible = items.filter((i) => states[i.id]?.status !== "done");
  const decided = items.filter((i) => states[i.id]?.status === "done");

  return (
    <div>
      {decided.length > 0 && (
        <div className="border-b border-paper-200 bg-status-success-bg/50 px-5 py-2 font-sans text-xs text-status-success">
          {decided.length} decision(s) recorded this session —{" "}
          {decided.map((d) => `${d.title.slice(0, 30)} ${states[d.id]?.decision}`).join(" · ")}
        </div>
      )}
      {visible.length === 0 && (
        <div className="px-5 py-6 font-sans text-sm text-muted-foreground">
          No approvals are currently waiting on your roles.
        </div>
      )}
      <ul className="divide-y divide-paper-200">
        {visible.map((r) => {
          const st = states[r.id] ?? { status: "idle" };
          const busy = st.status === "deciding";
          return (
            <li key={r.id} className={`px-5 py-4 transition-opacity ${busy ? "opacity-50" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink">{r.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{humanize(r.subject_type)}</Badge>
                    <span className="font-sans text-xs text-muted-foreground">
                      {humanize(r.approver_role)} · step {r.sequence_order} · {r.entity_name}
                    </span>
                    {r.is_urgent && (
                      <Badge className="border-status-warning/30 bg-status-warning-bg text-status-warning">Urgent</Badge>
                    )}
                    {r.is_board_step && (
                      <Badge className="border-status-danger/30 bg-status-danger-bg text-status-danger">Board gate</Badge>
                    )}
                  </div>
                  {st.status === "error" && (
                    <p className="mt-2 rounded border border-status-danger/30 bg-status-danger-bg px-2 py-1 font-sans text-xs text-status-danger">
                      {st.error}
                    </p>
                  )}
                </div>
                <div className="text-right font-display text-xl text-ink">{money(r.amount, r.currency)}</div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={comments[r.id] ?? ""}
                  onChange={(e) => setComments((c) => ({ ...c, [r.id]: e.target.value }))}
                  placeholder="Comments or rejection reason"
                  disabled={busy}
                  className="h-9 min-w-[220px] flex-1 rounded border border-paper-300 bg-paper px-2 font-sans text-sm"
                />
                <button
                  onClick={() => decide(r.id, "approved")}
                  disabled={busy}
                  className="rounded-md border border-ink bg-ink px-4 py-2 font-sans text-sm font-bold text-paper disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => decide(r.id, "rejected")}
                  disabled={busy}
                  className="rounded-md border border-status-danger/50 px-4 py-2 font-sans text-sm font-bold text-status-danger hover:bg-status-danger-bg disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
