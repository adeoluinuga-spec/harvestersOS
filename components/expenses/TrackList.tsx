"use client";

import { useState } from "react";
import { Badge, Button, Modal } from "@/components/ui";
import { humanize } from "@/lib/enums";
import { compactMoney, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TrackRow = {
  id: string;
  description: string;
  category: string;
  entity: string;
  status: string;
  urgent: boolean;
  neededBy: string | null;
  net: number;
  wht: number;
  currency: string;
};
export type TrackChainStep = {
  requestId: string;
  role: string;
  status: string;
  sequence: number;
  isBoard: boolean;
  decidedAt: string | null;
};

const STEP_TONE: Record<string, string> = {
  approved: "bg-status-success",
  rejected: "bg-status-danger",
  pending: "bg-status-warning animate-pulse",
};

export function TrackList({
  rows, chains, nudgeAction,
}: {
  rows: TrackRow[];
  chains: TrackChainStep[];
  nudgeAction: (formData: FormData) => void | Promise<void>;
}) {
  const [active, setActive] = useState<TrackRow | null>(null);
  const steps = active ? chains.filter((c) => c.requestId === active.id) : [];
  const pending = steps.find((s) => s.status === "pending");

  if (rows.length === 0)
    return <p className="px-4 py-6 font-sans text-sm text-muted-foreground">You have not submitted any requisitions yet.</p>;

  return (
    <>
      <div className="divide-y divide-paper-200">
        {rows.map((r) => (
          <button key={r.id} type="button" onClick={() => setActive(r)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-50">
            <div className="min-w-0 flex-1">
              <div className="truncate font-sans text-sm font-medium text-ink">{r.description}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 font-sans text-[11px] text-muted-foreground">
                <span>{r.entity}</span>
                <span>· {humanize(r.category)}</span>
                {r.urgent && <Badge className="border-status-warning/30 bg-status-warning-bg text-status-warning">Urgent</Badge>}
              </div>
            </div>
            <Badge variant="outline">{humanize(r.status)}</Badge>
            <span className="shrink-0 font-sans text-sm font-semibold tabular-nums">{compactMoney(r.net, r.currency)}</span>
          </button>
        ))}
      </div>

      <Modal open={!!active} onClose={() => setActive(null)} title={active?.description}
        description={active ? `${active.entity} · ${humanize(active.status)}${active.neededBy ? ` · needed by ${shortDate(active.neededBy)}` : ""}` : undefined}>
        {active && (
          <div className="space-y-4">
            {steps.length === 0 ? (
              <p className="font-sans text-sm text-muted-foreground">
                No approval chain yet — the request is awaiting compilation into a batch by your finance officer.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Approval chain</div>
                {steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STEP_TONE[s.status] ?? "bg-status-neutral")} />
                    <div className="min-w-0 flex-1">
                      <span className="font-sans text-sm text-ink">{humanize(s.role)}</span>
                      {s.isBoard && <span className="ml-1.5 rounded bg-ink px-1.5 py-0.5 font-sans text-[9px] font-bold uppercase text-paper">Board</span>}
                    </div>
                    <span className="shrink-0 font-sans text-xs text-muted-foreground">
                      {s.status === "pending" ? "Awaiting" : `${humanize(s.status)}${s.decidedAt ? ` · ${shortDate(s.decidedAt.slice(0, 10))}` : ""}`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {pending && (
              <form action={nudgeAction} className="rounded border border-paper-200 bg-paper-50 p-3">
                <input type="hidden" name="request_id" value={active.id} />
                <div className="mb-2 font-sans text-xs text-muted-foreground">
                  Waiting on <span className="font-semibold text-ink">{humanize(pending.role)}</span>. Send a reminder by
                  in-app notice, email and WhatsApp/SMS.
                </div>
                <Button type="submit" size="sm">Send reminder</Button>
              </form>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
