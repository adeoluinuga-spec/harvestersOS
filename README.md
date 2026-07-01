# Harvesters Finance OS

A ledger-grade financial operating system for **Harvesters International
Christian Centre**.

> **Founding principle.** Every financial module sits on top of one immutable,
> append-only, double-entry ledger. Every transaction has a debit and a credit
> side that must balance. **Nothing is ever deleted** — corrections are
> reversing entries. Balances are always *derived* from the ledger, never
> written directly. This rule is enforced from the foundation up so that audit,
> compliance, and "who changed what" are possible without a rebuild.

## Status — Phase 0 (Scaffold)

This phase is **shell, design system, and folder architecture only**. There are
no data models or business logic yet.

- ✅ Next.js 14 (App Router) + TypeScript
- ✅ Tailwind design system — strict black / white with silver as a sparing accent
- ✅ Typography — Futura (display) with fallbacks, Montserrat (body/UI)
- ✅ Component library foundation — Card, Table, Form, Modal, Badge, StatusPill, Button
- ✅ Persistent collapsible left sidebar shell with all module links
- ✅ Module folder architecture under `app/(modules)/*`
- ✅ Supabase client wiring + environment templates

## Design system

| Token | Value | Usage |
| --- | --- | --- |
| `ink` | `#0A0A0A` (+ shades) | Primary — text, primary buttons, sidebar |
| `paper` | `#FFFFFF` (+ shades) | Surfaces, cards, backgrounds |
| `silver` | `#C0C0C0` / `#D4D4D4` | **Accent only** — dividers, active states, highlights |
| `status.*` | desaturated | Approval / ledger-state pills **only** |

- **Display / headings:** Futura (`--font-display`) — falls back to Futura PT /
  Century Gothic / Montserrat until real Futura files are supplied. Drop them in
  `public/fonts` and uncomment the `@font-face` blocks in `app/globals.css`.
- **Body / UI:** Montserrat (Google Font, via `next/font`).
- No default SaaS blue/purple anywhere.

## Project structure

```
app/
  (modules)/            # module route group
    givings/  expenses/  payroll/  budgeting/  funds/
    events/   next-level-prayers/  international/  analytics/  admin/
  layout.tsx            # root layout -> AppShell
  page.tsx              # dashboard (overview)
  globals.css           # design tokens + font stacks
components/
  shell/                # AppShell, Sidebar, Topbar, ModulePlaceholder
  ui/                   # Card, Table, Form, Modal, Badge, StatusPill, Button
lib/
  navigation.ts         # nav manifest (single source of truth)
  utils.ts              # cn() class merger
  supabase/             # browser + server client wiring
supabase/               # (empty) — schema & migrations arrive with the ledger
```

## Getting started

```bash
cp .env.local.example .env.local   # fill in Supabase keys
npm install
npm run dev                        # http://localhost:3000
```

## Environment

See [`.env.local.example`](./.env.local.example). Set the same variables in your
hosting provider for production. The `SUPABASE_SERVICE_ROLE_KEY` is server-only —
never prefix it with `NEXT_PUBLIC_`.

## Brand

Harvesters International Christian Centre — black & white, occasional silver.
Futura (display) / Montserrat (body).
