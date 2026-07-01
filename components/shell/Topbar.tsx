"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Search, ShieldCheck } from "lucide-react";
import { ALL_NAV_ITEMS } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/client";

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
    <header className="sticky top-0 z-10 border-b border-paper-200/80 bg-background/78 px-5 py-3 backdrop-blur-xl sm:px-7 lg:px-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-champagne" />
            Ledger-grade control
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-display text-ink">
            {current?.label ?? "Dashboard"}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden h-10 items-center gap-2 rounded-full border border-paper-200 bg-surface px-3 shadow-card xl:flex">
            <Search className="h-4 w-4 text-muted-foreground" />
            <span className="font-sans text-xs text-muted-foreground">
              Search coming soon
            </span>
          </div>
          {email && (
            <div className="hidden text-right sm:block">
              <div className="font-sans text-xs font-semibold text-ink">{email}</div>
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center gap-1 font-sans text-[11px] font-semibold text-muted-foreground transition-colors hover:text-ink"
              >
                <LogOut className="h-3 w-3" />
                Sign out
              </button>
            </div>
          )}
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-champagne/45 bg-ink font-display text-xl font-semibold uppercase text-champagne shadow-lift">
            {email ? email[0] : "H"}
          </div>
        </div>
      </div>
    </header>
  );
}
