"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  CalendarDays,
  FileBarChart2,
  Gauge,
  Globe2,
  HandCoins,
  Landmark,
  LayoutDashboard,
  LineChart,
  LockKeyhole,
  PiggyBank,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { NAV_SECTIONS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "/": LayoutDashboard,
  "/givings": HandCoins,
  "/expenses": ReceiptText,
  "/payroll": UsersRound,
  "/budgeting": BarChart3,
  "/funds": PiggyBank,
  "/events": CalendarDays,
  "/next-level-prayers": Sparkles,
  "/international": Globe2,
  "/governance": ShieldCheck,
  "/reconciliation": Landmark,
  "/analytics": LineChart,
  "/reports": FileBarChart2,
  "/admin": LockKeyhole,
};

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-hidden bg-ink text-paper shadow-overlay lg:flex">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(200,169,106,0.24),transparent_18rem)]" />
      <div className="relative flex h-24 items-center gap-3 border-b border-white/10 px-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-champagne/50 bg-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
          <Building2 className="h-6 w-6 text-champagne" />
        </div>
        <div className="leading-tight">
          <div className="font-display text-2xl font-semibold text-paper">
            Harvesters
          </div>
          <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-champagne">
            Finance OS
          </div>
        </div>
      </div>

      <nav className="relative flex-1 overflow-y-auto px-4 py-5">
        {NAV_SECTIONS.map((section) => (
          <div key={section.heading} className="mb-6">
            <div className="px-3 pb-2 font-sans text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">
              {section.heading}
            </div>
            <ul className="space-y-1.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                const Icon = ICONS[item.href] ?? Gauge;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-lg px-3 py-3 font-sans text-sm font-semibold transition-all duration-200",
                        active
                          ? "bg-paper text-ink shadow-[0_18px_36px_rgba(0,0,0,0.28)]"
                          : "text-paper/72 hover:bg-white/8 hover:text-paper"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-md border transition-all duration-200",
                          active
                            ? "border-champagne/45 bg-champagne-light text-ink"
                            : "border-white/10 bg-white/5 text-champagne group-hover:border-champagne/35 group-hover:bg-white/10"
                        )}
                      >
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {active && (
                        <span className="h-2 w-2 rounded-full bg-champagne shadow-[0_0_0_4px_rgba(200,169,106,0.18)]" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="relative border-t border-white/10 p-5">
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="font-display text-xl font-semibold text-paper">
            Stewardship
          </div>
          <p className="mt-1 font-sans text-xs leading-relaxed text-paper/58">
            Ledger truth, governance clarity, and ministry intelligence.
          </p>
        </div>
      </div>
    </aside>
  );
}
