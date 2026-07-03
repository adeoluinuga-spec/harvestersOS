"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Modal } from "@/components/ui";
import { compactMoney, money } from "@/lib/format";
import { humanize } from "@/lib/enums";
import { cn } from "@/lib/utils";

export type BudgetLineView = {
  id: string;
  entity: string;
  accountCode: string;
  accountName: string;
  approved: number;
  committed: number; // non-draft requisitions against the line
};
export type Commitment = { lineId: string; description: string; amount: number; currency: string; status: string; created: string };

/**
 * Clickable budget-availability list. The callout explains what makes up the
 * figure: approved budget − committed requisitions = available headroom, with
 * the individual requisitions that consume it.
 */
export function BudgetAvailability({ lines, commitments }: { lines: BudgetLineView[]; commitments: Commitment[] }) {
  const [active, setActive] = useState<BudgetLineView | null>(null);
  if (lines.length === 0)
    return <p className="font-sans text-sm text-muted-foreground">No approved budget lines are available yet.</p>;

  const items = active ? commitments.filter((c) => c.lineId === active.id) : [];
  const available = active ? active.approved - active.committed : 0;
  const ratio = active && active.approved > 0 ? active.committed / active.approved : 0;

  return (
    <>
      <div className="space-y-1">
        {lines.map((b) => {
          const avail = b.approved - b.committed;
          const pct = b.approved > 0 ? Math.min(100, Math.round((b.committed / b.approved) * 100)) : 0;
          return (
            <button key={b.id} type="button" onClick={() => setActive(b)}
              className="w-full rounded border border-transparent px-2 py-2 text-left transition-colors hover:border-paper-200 hover:bg-paper-50">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-sans text-sm font-medium text-ink">{b.entity}</span>
                <span className={cn("shrink-0 font-sans text-xs font-semibold tabular-nums", avail < 0 ? "text-status-danger" : "text-status-success")}>
                  {compactMoney(avail)} left
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-paper-200">
                <div className={cn("h-full rounded-full", pct >= 100 ? "bg-status-danger" : pct >= 80 ? "bg-status-warning" : "bg-champagne")} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-0.5 font-sans text-[11px] text-muted-foreground">
                {b.accountCode} {b.accountName} · {pct}% committed
              </div>
            </button>
          );
        })}
      </div>

      <Modal open={!!active} onClose={() => setActive(null)} title={active ? `${active.entity} · ${active.accountCode}` : undefined}
        description="What makes up this budget line"
        footer={
          <Link href="/budgeting" className="inline-flex h-9 items-center gap-1.5 rounded border border-ink bg-ink px-3 font-sans text-xs font-semibold text-paper hover:bg-ink-800">
            Open budgeting <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }>
        {active && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded bg-paper-50 px-2 py-2">
                <div className="font-sans text-[10px] uppercase tracking-wide text-muted-foreground">Approved</div>
                <div className="font-sans text-sm font-semibold">{compactMoney(active.approved)}</div>
              </div>
              <div className="rounded bg-paper-50 px-2 py-2">
                <div className="font-sans text-[10px] uppercase tracking-wide text-muted-foreground">Committed</div>
                <div className="font-sans text-sm font-semibold">{compactMoney(active.committed)}</div>
              </div>
              <div className={cn("rounded px-2 py-2", available < 0 ? "bg-status-danger-bg" : "bg-status-success-bg")}>
                <div className="font-sans text-[10px] uppercase tracking-wide text-muted-foreground">Available</div>
                <div className={cn("font-sans text-sm font-semibold", available < 0 ? "text-status-danger" : "text-status-success")}>
                  {compactMoney(available)}
                </div>
              </div>
            </div>
            <p className="font-sans text-xs text-muted-foreground">
              Available = approved budget − every non-draft requisition already raised against this line ({Math.round(ratio * 100)}% committed).
            </p>
            <div className="max-h-56 divide-y divide-paper-200 overflow-y-auto">
              {items.length === 0 && <p className="py-2 font-sans text-sm text-muted-foreground">No requisitions against this line yet — the full approved amount is available.</p>}
              {items.map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-sans text-sm text-ink">{c.description}</div>
                    <div className="font-sans text-[11px] text-muted-foreground">{c.created} · {humanize(c.status)}</div>
                  </div>
                  <span className="shrink-0 font-sans text-sm font-medium tabular-nums">{money(c.amount, c.currency)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
