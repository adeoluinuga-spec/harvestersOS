"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/**
 * Persistent application shell: fixed left sidebar + top bar + scrollable
 * content region. The sidebar is collapsed by default (Phase 0 requirement).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  // Collapsed by default.
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="flex min-h-screen w-full bg-paper-50">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 px-6 py-6 lg:px-10 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
