"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import { compactMoney, money } from "@/lib/format";
import { humanize } from "@/lib/enums";

function OpenLink({ href, label = "Open" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="inline-flex h-9 items-center gap-1.5 rounded border border-ink bg-ink px-3 font-sans text-xs font-semibold text-paper hover:bg-ink-800">
      {label}
      <ArrowUpRight className="h-3.5 w-3.5" />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// KPI card — compact value, severity dot (red glow / green), click → callout.
// ---------------------------------------------------------------------------
export function KpiCard({
  label, display, caption, status, href, children,
}: {
  label: string;
  display: string;
  caption: string;
  status: "attention" | "healthy";
  href: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const attention = status === "attention";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex h-full w-full flex-col rounded-md border border-paper-200 bg-surface p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-ink"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {label}
          </span>
          {attention ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-status-danger-bg px-1.5 py-0.5 font-sans text-[9px] font-bold uppercase tracking-wide text-status-danger">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-danger shadow-[0_0_0_3px_rgba(139,43,43,0.20)]" />
              Attention
            </span>
          ) : (
            <span className="h-2 w-2 rounded-full bg-status-success" title="Healthy" />
          )}
        </div>
        <div className="mt-2 truncate font-display text-2xl font-semibold tracking-display text-ink">
          {display}
        </div>
        <div className="mt-auto pt-2 font-sans text-[10px] text-muted-foreground">
          Tap for detail →
        </div>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={label} description={caption} footer={<OpenLink href={href} />}>
        {children}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Breakdown list used inside KPI callouts.
// ---------------------------------------------------------------------------
export function BreakdownList({ rows }: { rows: { name: string; value: string; sub?: string }[] }) {
  if (rows.length === 0) return <p className="font-sans text-sm text-muted-foreground">Nothing to show.</p>;
  return (
    <div className="divide-y divide-paper-200">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-2">
          <div>
            <div className="font-sans text-sm font-medium text-ink">{r.name}</div>
            {r.sub && <div className="font-sans text-xs text-muted-foreground">{r.sub}</div>}
          </div>
          <div className="font-sans text-sm font-semibold text-ink">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget vs actual — colour-coded, each group clickable.
// ---------------------------------------------------------------------------
type BudgetRow = { entityId: string; name: string; approved: number; actual: number; variance: number; ratio: number };

function budgetTone(ratio: number) {
  if (ratio > 1.0) return { label: "Over budget", cls: "text-status-danger", bar: "bg-status-danger", bg: "bg-status-danger-bg" };
  if (ratio >= 0.9) return { label: "Near limit", cls: "text-status-warning", bar: "bg-status-warning", bg: "bg-status-warning-bg" };
  return { label: "On track", cls: "text-status-success", bar: "bg-status-success", bg: "bg-status-success-bg" };
}

export function BudgetVsActual({ rows }: { rows: BudgetRow[] }) {
  const [active, setActive] = useState<BudgetRow | null>(null);
  if (rows.length === 0) return <p className="p-4 font-sans text-sm text-muted-foreground">No group budget rows yet.</p>;
  return (
    <>
      <div className="divide-y divide-paper-200">
        {rows.map((r) => {
          const tone = budgetTone(r.ratio);
          const pct = Math.min(100, Math.round(r.ratio * 100));
          return (
            <button key={r.entityId} type="button" onClick={() => setActive(r)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-paper-50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-ink">{r.name}</span>
                  <span className={cn("shrink-0 font-sans text-[11px] font-semibold", tone.cls)}>{tone.label}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-paper-200">
                  <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 flex justify-between font-sans text-[11px] text-muted-foreground">
                  <span>{compactMoney(r.actual)} actual</span>
                  <span>of {compactMoney(r.approved)}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <Modal open={!!active} onClose={() => setActive(null)} title={active?.name} description="Budget vs actual (all funds)"
        footer={<OpenLink href="/budgeting" label="Open budgeting" />}>
        {active && (
          <BreakdownList rows={[
            { name: "Approved budget", value: money(active.approved) },
            { name: "Actual to date", value: money(active.actual) },
            { name: "Variance", value: money(active.variance) },
            { name: "Utilisation", value: `${Math.round(active.ratio * 100)}%`, sub: budgetTone(active.ratio).label },
          ]} />
        )}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Approvals — All (org-wide) / Mine toggle.
// ---------------------------------------------------------------------------
type Approval = { id: string; role: string; board: boolean; description: string; entity: string; amount: number; currency: string };

export function ApprovalsPanel({ all, mine }: { all: Approval[]; mine: Approval[] }) {
  const [tab, setTab] = useState<"all" | "mine">(mine.length > 0 ? "mine" : "all");
  const rows = tab === "all" ? all : mine;
  return (
    <div>
      <div className="flex items-center gap-1 border-b border-paper-200 px-4 py-2">
        {(["mine", "all"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={cn("rounded px-3 py-1 font-sans text-xs font-semibold transition-colors",
              tab === t ? "bg-ink text-paper" : "text-muted-foreground hover:text-ink")}>
            {t === "mine" ? `Awaiting me (${mine.length})` : `Org-wide (${all.length})`}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 font-sans text-sm text-muted-foreground">
          {tab === "mine"
            ? "Nothing is routed to you personally — approvals go to pastors and the board, not super-admins. Switch to Org-wide to oversee the queue."
            : "No pending approvals."}
        </p>
      ) : (
        <div className="max-h-80 divide-y divide-paper-200 overflow-y-auto">
          {rows.map((r) => (
            <Link key={r.id} href="/expenses/approvals" className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-paper-50">
              <div className="min-w-0 flex-1">
                <div className="truncate font-sans text-sm font-medium text-ink">{r.description}</div>
                <div className="font-sans text-xs text-muted-foreground">{r.entity}</div>
              </div>
              <span className={cn("shrink-0 rounded px-2 py-0.5 font-sans text-[10px] font-semibold uppercase",
                r.board ? "bg-ink text-paper" : "border border-silver text-ink-600")}>
                {humanize(r.role)}
              </span>
              <span className="shrink-0 font-sans text-sm font-semibold text-ink">{compactMoney(r.amount, r.currency)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic attention card — items with severity + click callout + link.
// Used for compliance, maturities, and restricted funds (with AI analysis).
// ---------------------------------------------------------------------------
export type DetailItem = {
  title: string;
  lines: string[];
  severity?: "high" | "medium" | "none";
  href?: string;
  aiQuery?: string; // if set, adds an "Analyze with AI" action
};

export function DetailCard({ items, emptyLabel, href }: { items: DetailItem[]; emptyLabel: string; href: string }) {
  const [active, setActive] = useState<DetailItem | null>(null);
  const dot = (s?: string) =>
    s === "high" ? "bg-status-danger shadow-[0_0_0_3px_rgba(139,43,43,0.18)] animate-pulse"
      : s === "medium" ? "bg-status-warning" : "bg-status-neutral";
  return (
    <>
      {items.length === 0 ? (
        <p className="px-4 py-6 font-sans text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="max-h-80 divide-y divide-paper-200 overflow-y-auto">
          {items.map((it, i) => (
            <button key={i} type="button" onClick={() => setActive(it)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-50">
              {it.severity && it.severity !== "none" && (
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot(it.severity))} />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-sans text-sm font-medium text-ink">{it.title}</div>
                <div className="font-sans text-xs text-muted-foreground">{it.lines[0]}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      <Modal open={!!active} onClose={() => setActive(null)} title={active?.title}
        footer={
          <div className="flex items-center gap-2">
            {active?.aiQuery && (
              <Link href={`/analytics/query?q=${encodeURIComponent(active.aiQuery)}`}
                className="inline-flex h-9 items-center gap-1.5 rounded border border-champagne/55 bg-champagne-light px-3 font-sans text-xs font-semibold text-ink hover:border-ink">
                <Sparkles className="h-3.5 w-3.5" /> Analyze with AI
              </Link>
            )}
            <OpenLink href={active?.href ?? href} />
          </div>
        }>
        {active && (
          <div className="space-y-1.5 font-sans text-sm text-ink-700">
            {active.lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </Modal>
    </>
  );
}
