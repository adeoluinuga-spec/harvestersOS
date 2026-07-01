"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col border-r border-silver-light bg-ink text-paper transition-[width] duration-200 ease-out",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Brand / wordmark */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-ink-700 px-4",
          collapsed && "justify-center px-0"
        )}
      >
        {collapsed ? (
          <span className="font-display text-lg tracking-display">H</span>
        ) : (
          <div className="leading-tight">
            <div className="font-display text-sm tracking-display text-paper">
              HARVESTERS
            </div>
            <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-silver">
              Finance OS
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.heading} className="mb-5">
            {!collapsed && (
              <div className="px-4 pb-2 font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                {section.heading}
              </div>
            )}
            <ul className="space-y-0.5 px-2">
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded px-2 py-2 font-sans text-sm transition-colors",
                        collapsed && "justify-center px-0",
                        active
                          ? "bg-ink-800 text-paper"
                          : "text-ink-300 hover:bg-ink-800/60 hover:text-paper"
                      )}
                    >
                      {/* Silver active indicator — the accent's sanctioned use */}
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-silver" />
                      )}
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center text-[11px] font-semibold",
                          active ? "text-silver" : "text-ink-400 group-hover:text-silver"
                        )}
                      >
                        {item.glyph}
                      </span>
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={cn(
          "flex h-12 items-center gap-3 border-t border-ink-700 px-4 font-sans text-xs text-ink-300 transition-colors hover:text-paper",
          collapsed && "justify-center px-0"
        )}
      >
        <span className="text-base leading-none">{collapsed ? "»" : "«"}</span>
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
