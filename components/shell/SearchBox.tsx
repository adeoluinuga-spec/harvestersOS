"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

type Hit = { type: string; label: string; sub: string; href: string };

export function SearchBox() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        setHits(r.ok ? await r.json() : []);
      } catch { setHits([]); }
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const go = (href: string) => { router.push(href); setOpen(false); setQ(""); };

  return (
    <div ref={ref} className="relative">
      <div className="flex h-10 items-center gap-2 rounded-full border border-paper-200 bg-surface px-3 shadow-card">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); if (e.key === "Enter" && hits[0]) go(hits[0].href); }}
          placeholder="Search entities, givers, vendors…"
          className="w-40 bg-transparent font-sans text-xs text-ink outline-none placeholder:text-muted-foreground xl:w-56"
        />
      </div>
      {open && q.trim().length >= 2 && (
        <div className="absolute right-0 z-30 mt-2 max-h-96 w-80 overflow-y-auto rounded-md border border-paper-200 bg-surface shadow-overlay">
          {hits.length === 0 ? (
            <div className="px-3 py-3 font-sans text-xs text-muted-foreground">{loading ? "Searching…" : "No matches in your scope."}</div>
          ) : (
            hits.map((h, i) => (
              <button key={i} type="button" onMouseDown={() => go(h.href)}
                className="flex w-full items-center justify-between gap-2 border-b border-paper-100 px-3 py-2 text-left last:border-0 hover:bg-paper-50">
                <div className="min-w-0">
                  <div className="truncate font-sans text-sm text-ink">{h.label}</div>
                  <div className="truncate font-sans text-[11px] text-muted-foreground">{h.sub}</div>
                </div>
                <span className="shrink-0 rounded border border-silver px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wide text-muted-foreground">{h.type}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
