"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { ALL_NAV_ITEMS } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/client";
import { CommandPalette } from "./CommandPalette";

/** Calm topbar: page context on the left, ⌘K and identity on the right. */
export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  const current =
    ALL_NAV_ITEMS.find((i) =>
      i.href === "/" ? pathname === "/" : pathname.startsWith(i.href)
    ) ?? ALL_NAV_ITEMS[0];

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-10 border-b border-paper-200 bg-surface/90 px-5 py-3 backdrop-blur-xl sm:px-7 lg:px-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-lg font-semibold tracking-display text-ink">
          {current?.label ?? "Dashboard"}
        </h1>

        <div className="flex items-center gap-3">
          <CommandPalette />
          {email && (
            <div className="hidden items-center gap-3 sm:flex">
              <div className="text-right">
                <div className="font-sans text-xs font-medium text-ink">{email}</div>
                <div className="flex items-center justify-end gap-3">
                  <a
                    href="/account/security"
                    className="font-sans text-[11px] text-muted-foreground transition-colors hover:text-ink"
                  >
                    Security
                  </a>
                  <button
                    type="button"
                    onClick={logout}
                    className="inline-flex items-center gap-1 font-sans text-[11px] text-muted-foreground transition-colors hover:text-ink"
                  >
                    <LogOut className="h-3 w-3" />
                    Sign out
                  </button>
                </div>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-paper-100 font-sans text-sm font-semibold uppercase text-ink-600">
                {email[0]}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
