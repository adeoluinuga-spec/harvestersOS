import type { Config } from "tailwindcss";

/**
 * Harvesters Finance OS — Design System
 * -------------------------------------
 * Strict monochrome, editorial, high-contrast.
 *   • ink    — black family (primary)
 *   • paper  — white family (surfaces)
 *   • silver — ACCENT ONLY: dividers, active states, highlights. Never a primary fill.
 *
 * No default SaaS blue/purple anywhere. The only chromatic values are the
 * intentionally desaturated, editorial status colors used exclusively for
 * approval/ledger-state semantics (pills/badges) — not for UI chrome.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic tokens (resolve to CSS vars set in globals.css)
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: "var(--surface)",
        border: "var(--border)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",

        // Black family — the primary palette
        ink: {
          DEFAULT: "#0A0A0A",
          950: "#050505",
          900: "#0A0A0A",
          800: "#161616",
          700: "#232323",
          600: "#333333",
          500: "#4D4D4D",
          400: "#6B6B6B",
          300: "#8F8F8F",
        },

        // White family — surfaces
        paper: {
          DEFAULT: "#FFFFFF",
          50: "#FAFAFA",
          100: "#F4F4F4",
          200: "#EAEAEA",
          300: "#DCDCDC",
        },

        // Silver — ACCENT ONLY
        silver: {
          DEFAULT: "#C0C0C0",
          light: "#D4D4D4",
          dark: "#A8A8A8",
        },

        // Editorial status palette — desaturated, used only for state semantics
        status: {
          success: "#1F6F43",
          "success-bg": "#EFF4F1",
          warning: "#8A6D1F",
          "warning-bg": "#F6F2E9",
          danger: "#8B2B2B",
          "danger-bg": "#F6EDED",
          neutral: "#4D4D4D",
          "neutral-bg": "#F2F2F2",
        },
      },
      fontFamily: {
        // Futura (or closest available) — headings & display
        display: ["var(--font-display)"],
        // Montserrat — body, labels, UI chrome
        sans: ["var(--font-montserrat)", "system-ui", "sans-serif"],
        body: ["var(--font-montserrat)", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        // Futura reads best with slightly open tracking on display text
        display: "0.02em",
        "display-tight": "-0.01em",
      },
      borderColor: {
        DEFAULT: "var(--border)",
      },
      borderRadius: {
        sm: "2px",
        DEFAULT: "3px",
        md: "4px",
        lg: "6px",
      },
      boxShadow: {
        // Restrained, neutral shadows — no colored glows
        card: "0 1px 2px rgba(10,10,10,0.05), 0 1px 3px rgba(10,10,10,0.04)",
        overlay: "0 10px 40px rgba(10,10,10,0.18)",
        "focus-ring": "0 0 0 2px #FFFFFF, 0 0 0 4px #0A0A0A",
      },
    },
  },
  plugins: [],
};
export default config;
