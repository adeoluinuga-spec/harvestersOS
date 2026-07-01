"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ALL_NAV_ITEMS } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/client";

/** Top bar with a derived page title and the signed-in account + logout. */
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
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-paper-200 bg-paper/90 px-6 backdrop-blur lg:px-10">
      <h1 className="font-display text-lg tracking-display text-ink">
        {current?.label ?? "Dashboard"}
      </h1>

      <div className="flex items-center gap-4">
        {email && (
          <div className="hidden text-right sm:block">
            <div className="font-sans text-xs font-medium text-ink">{email}</div>
            <button
              type="button"
              onClick={logout}
              className="font-sans text-[11px] text-muted-foreground hover:text-ink"
            >
              Sign out
            </button>
          </div>
        )}
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-silver bg-paper font-display text-sm uppercase text-ink">
          {email ? email[0] : "H"}
        </div>
      </div>
    </header>
  );
}
