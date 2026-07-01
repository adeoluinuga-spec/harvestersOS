/**
 * Navigation manifest — the single source of truth for the module nav.
 * Each entry maps to a route under app/(modules)/<slug>.
 *
 * NOTE: This is nav/shell scaffolding only. No data models or business logic
 * are attached here — Phase 0 is architecture and design system only.
 */

export type NavItem = {
  /** URL path */
  href: string;
  /** Display label */
  label: string;
  /** Short glyph shown when the sidebar is collapsed (2 chars max) */
  glyph: string;
};

export type NavSection = {
  heading: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Overview",
    items: [{ href: "/", label: "Dashboard", glyph: "◆" }],
  },
  {
    heading: "Income & Outflow",
    items: [
      { href: "/givings", label: "Givings", glyph: "GV" },
      { href: "/expenses", label: "Expenses", glyph: "EX" },
      { href: "/payroll", label: "Payroll", glyph: "PY" },
    ],
  },
  {
    heading: "Planning",
    items: [
      { href: "/budgeting", label: "Budgeting", glyph: "BD" },
      { href: "/funds", label: "Funds", glyph: "FD" },
      { href: "/events", label: "Events", glyph: "EV" },
    ],
  },
  {
    heading: "Programmes",
    items: [
      { href: "/next-level-prayers", label: "Next Level Prayers", glyph: "NL" },
      { href: "/international", label: "International", glyph: "IN" },
    ],
  },
  {
    heading: "Insight & Control",
    items: [
      { href: "/governance", label: "Governance", glyph: "GG" },
      { href: "/reconciliation", label: "Reconciliation", glyph: "RC" },
      { href: "/analytics", label: "Analytics", glyph: "AN" },
      { href: "/reports", label: "Reports", glyph: "RP" },
      { href: "/admin", label: "Admin", glyph: "AD" },
    ],
  },
];

/** Flat list of every module route, useful for guards/breadcrumbs later. */
export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
