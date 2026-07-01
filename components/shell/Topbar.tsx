"use client";

import { usePathname } from "next/navigation";
import { ALL_NAV_ITEMS } from "@/lib/navigation";

/** Top bar with a derived page title and placeholder account chrome. */
export function Topbar() {
  const pathname = usePathname();

  const current =
    ALL_NAV_ITEMS.find((i) =>
      i.href === "/" ? pathname === "/" : pathname.startsWith(i.href)
    ) ?? ALL_NAV_ITEMS[0];

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-paper-200 bg-paper/90 px-6 backdrop-blur lg:px-10">
      <div>
        <h1 className="font-display text-lg tracking-display text-ink">
          {current?.label ?? "Dashboard"}
        </h1>
      </div>

      <div className="flex items-center gap-4">
        {/* Placeholder — no auth/account logic in Phase 0 */}
        <div className="hidden font-sans text-xs text-muted-foreground sm:block">
          Harvesters International Christian Centre
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-silver bg-paper font-display text-sm text-ink">
          H
        </div>
      </div>
    </header>
  );
}
