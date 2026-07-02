"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { compactMoney } from "@/lib/format";

export type GivingMetrics = {
  sunday: number; midweek: number; tithe: number; seed: number; partnership: number;
  redeemed: number; other: number; bank_transfer: number; pos: number; cash: number; online: number; total: number;
};
export type GivingNode = { id: string; name: string; type: string; metrics: GivingMetrics; children: GivingNode[] };

const COLS: { key: keyof GivingMetrics; label: string }[] = [
  { key: "sunday", label: "Sun offering" },
  { key: "midweek", label: "Midweek" },
  { key: "tithe", label: "Tithe" },
  { key: "seed", label: "Seed" },
  { key: "partnership", label: "Partnership" },
  { key: "redeemed", label: "Redeemed" },
  { key: "total", label: "Total" },
];

function Row({ node, level }: { node: GivingNode; level: number }) {
  const [open, setOpen] = useState(level === 0);
  const hasKids = node.children.length > 0;
  return (
    <>
      <tr className="border-b border-paper-200 hover:bg-paper-50">
        <td className="px-3 py-2" style={{ paddingLeft: 12 + level * 18 }}>
          <div className="flex items-center gap-1.5">
            {hasKids ? (
              <button type="button" onClick={() => setOpen((o) => !o)} className="text-muted-foreground hover:text-ink">
                <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
              </button>
            ) : (
              <span className="w-3.5" />
            )}
            <Link href={`/givings/breakdown/${node.id}`}
              className={cn("truncate hover:underline", level === 0 ? "font-display text-sm tracking-display text-ink" : "font-sans text-sm text-ink-700")}>
              {node.name}
            </Link>
          </div>
        </td>
        {COLS.map((c) => (
          <td key={c.key} className={cn("px-3 py-2 text-right font-sans text-xs tabular-nums",
            c.key === "total" ? "font-semibold text-ink" : "text-muted-foreground")}>
            {node.metrics[c.key] ? compactMoney(node.metrics[c.key]) : "—"}
          </td>
        ))}
      </tr>
      {open && node.children.map((k) => <Row key={k.id} node={k} level={level + 1} />)}
    </>
  );
}

export function GivingTree({ groups, ministries }: { groups: GivingNode[]; ministries: GivingNode[] }) {
  const all = [...groups, ...ministries];
  if (all.length === 0) return <p className="px-4 py-6 font-sans text-sm text-muted-foreground">No giving recorded yet.</p>;
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr>
            <th className="px-3 py-2 font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Entity</th>
            {COLS.map((c) => (
              <th key={c.key} className="px-3 py-2 text-right font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {all.map((n) => <Row key={n.id} node={n} level={0} />)}
        </tbody>
      </table>
    </div>
  );
}
