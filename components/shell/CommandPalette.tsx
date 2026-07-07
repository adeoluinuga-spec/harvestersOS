"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CalendarCheck2,
  FilePlus2,
  FileSpreadsheet,
  HandCoins,
  Keyboard,
  ListChecks,
  Scale,
  Search,
} from "lucide-react";
import { NAV_SECTIONS } from "@/lib/navigation";
import { Kbd } from "@/components/ui";
import { cn } from "@/lib/utils";

type RecordHit = { type: string; label: string; sub: string; href: string };
type Item = {
  key: string;
  group: "Actions" | "Go to" | "Records";
  label: string;
  sub?: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
};

/** Quick actions: verbs, not just nouns. */
const ACTIONS: Item[] = [
  { key: "a-record", group: "Actions", label: "Record a gift", href: "/givings/record", icon: HandCoins },
  { key: "a-batch", group: "Actions", label: "Batch service entry", sub: "Keyboard-first Sunday count", href: "/givings/batch", icon: Keyboard },
  { key: "a-req", group: "Actions", label: "New requisition", href: "/expenses/request", icon: FilePlus2 },
  { key: "a-approvals", group: "Actions", label: "Review approvals", href: "/expenses/approvals", icon: ListChecks },
  { key: "a-import", group: "Actions", label: "Import a spreadsheet", href: "/imports/new", icon: FileSpreadsheet },
  { key: "a-tb", group: "Actions", label: "Open trial balance", href: "/reports/trial-balance", icon: Scale },
  { key: "a-periods", group: "Actions", label: "Close accounting periods", href: "/admin/periods", icon: CalendarCheck2 },
];

const NAV_ITEMS: Item[] = NAV_SECTIONS.flatMap((s) =>
  s.items.map((i) => ({
    key: `n-${i.href}`,
    group: "Go to" as const,
    label: i.label,
    sub: s.heading,
    href: i.href,
  }))
);

/**
 * ⌘K command palette — Spotlight for the finance OS. One box finds records
 * (entities, givers, vendors, requisitions, accounts, journal entries — all
 * scope-filtered server-side) and runs actions. Search over navigation.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<RecordHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setHits([]);
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Scoped record search (debounced).
  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        setHits(r.ok ? await r.json() : []);
      } catch {
        setHits([]);
      }
      setLoading(false);
    }, 150);
    return () => clearTimeout(t);
  }, [q, open]);

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const matches = (i: Item) =>
      !needle ||
      i.label.toLowerCase().includes(needle) ||
      (i.sub ?? "").toLowerCase().includes(needle);
    const actions = ACTIONS.filter(matches);
    const nav = NAV_ITEMS.filter(matches).slice(0, needle ? 6 : 8);
    const records: Item[] = hits.map((h, i) => ({
      key: `r-${i}-${h.href}`,
      group: "Records",
      label: h.label,
      sub: `${h.type} · ${h.sub}`,
      href: h.href,
    }));
    return [...actions, ...nav, ...records];
  }, [q, hits]);

  useEffect(() => setActive(0), [items.length, q]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      go(items[active].href);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Keep the active row visible.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let lastGroup = "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-md border border-paper-300 bg-surface px-3 font-sans text-[13px] text-muted-foreground shadow-card transition-colors hover:border-silver-dark hover:text-ink"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden md:inline">Search or jump to…</span>
        <span className="ml-1 hidden items-center gap-0.5 md:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-ink/20 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute left-1/2 top-[18%] w-full max-w-xl -translate-x-1/2 px-4">
            <div className="overflow-hidden rounded-lg bg-surface shadow-overlay ring-1 ring-paper-200">
              <div className="flex items-center gap-3 border-b border-paper-200 px-4">
                <Search className="h-4 w-4 shrink-0 text-ink-300" />
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Search records, jump anywhere, run an action…"
                  className="h-12 w-full bg-transparent font-sans text-sm text-ink outline-none placeholder:text-ink-300"
                  aria-label="Command palette"
                />
                <Kbd>esc</Kbd>
              </div>
              <div ref={listRef} className="max-h-[420px] overflow-y-auto py-2">
                {items.length === 0 && (
                  <div className="px-4 py-6 text-center font-sans text-sm text-muted-foreground">
                    {loading
                      ? "Searching…"
                      : q.trim().length >= 2
                        ? "Nothing in your scope matches."
                        : "Type to search records, pages and actions."}
                  </div>
                )}
                {items.map((item, idx) => {
                  const heading = item.group !== lastGroup ? item.group : null;
                  lastGroup = item.group;
                  const Icon = item.icon ?? ArrowRight;
                  return (
                    <div key={item.key}>
                      {heading && (
                        <div className="px-4 pb-1 pt-3 font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-300">
                          {heading}
                        </div>
                      )}
                      <button
                        type="button"
                        data-idx={idx}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(item.href)}
                        className={cn(
                          "flex w-full items-center gap-3 px-4 py-2 text-left",
                          idx === active ? "bg-cobalt-light" : "hover:bg-paper-50"
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            idx === active ? "text-cobalt" : "text-ink-300"
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-sans text-sm text-ink">
                            {item.label}
                          </span>
                          {item.sub && (
                            <span className="block truncate font-sans text-xs text-muted-foreground">
                              {item.sub}
                            </span>
                          )}
                        </span>
                        {idx === active && (
                          <Kbd className="shrink-0">↵</Kbd>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
