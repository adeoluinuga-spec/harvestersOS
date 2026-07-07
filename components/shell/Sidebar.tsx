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
  Warehouse,
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
  "/assets": Warehouse,
  "/events": CalendarDays,
  "/next-level-prayers": Sparkles,
  "/international": Globe2,
  "/governance": ShieldCheck,
  "/reconciliation": Landmark,
  "/analytics": LineChart,
  "/reports": FileBarChart2,
  "/admin": LockKeyhole,
};

/**
 * Almost-white sidebar (Phase 4 charter): quiet, icon-led, the active item
 * carries the only color on the rail. Complexity lives in the workspaces,
 * not the navigation.
 */
export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-paper-200 bg-paper-50 lg:flex">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-cobalt text-white">
          <Building2 className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <div className="font-display text-[15px] font-semibold tracking-display text-ink">
            Harvesters
          </div>
          <div className="font-sans text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Finance OS
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-6 pt-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.heading} className="mb-5">
            <div className="px-3 pb-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-300">
              {section.heading}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                const Icon = ICONS[item.href] ?? Gauge;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-md px-3 py-1.5 font-sans text-[13px] font-medium transition-colors",
                        active
                          ? "bg-cobalt-light font-semibold text-cobalt-dark"
                          : "text-ink-500 hover:bg-paper-100 hover:text-ink"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors",
                          active ? "text-cobalt" : "text-ink-300 group-hover:text-ink-500"
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-paper-200 px-5 py-4">
        <p className="font-sans text-[11px] leading-relaxed text-ink-300">
          Ledger truth · governance clarity
        </p>
      </div>
    </aside>
  );
}
