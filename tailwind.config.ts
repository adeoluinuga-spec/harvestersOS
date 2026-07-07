import type { Config } from "tailwindcss";

/**
 * Design tokens — enterprise minimalism (Phase 4).
 *
 * The semantic token NAMES are stable (ink/paper/silver/champagne/cobalt/…)
 * so every existing page restyles through this file alone. Values follow the
 * Phase 4 charter: pure white, #FAFAFA secondary, neutral greys, ONE deep-blue
 * accent, emerald/amber/red status colors, soft shadows over hard borders,
 * 8px spacing rhythm.
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
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: "var(--surface)",
        border: "var(--border)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",

        // Near-black text ramp (neutral, no warm cast).
        ink: {
          DEFAULT: "#0A0B0D",
          950: "#050608",
          900: "#0A0B0D",
          800: "#16181D",
          700: "#24272E",
          600: "#3A3E48",
          500: "#565B66",
          400: "#6F7480",
          300: "#9BA0AA",
        },

        // Surfaces: pure white with a cool grey ramp for fills and borders.
        paper: {
          DEFAULT: "#FFFFFF",
          50: "#FAFAFA",
          100: "#F4F5F6",
          200: "#ECECEE",
          300: "#DFE1E4",
        },

        // Neutral hairline grey (was metallic gold; now a true neutral).
        silver: {
          DEFAULT: "#D7DAE0",
          light: "#ECEEF1",
          dark: "#AEB3BC",
        },

        // Legacy accent token, remapped to the soft end of the blue accent so
        // existing borders/washes read as calm blue-greys.
        champagne: {
          DEFAULT: "#C9D4F5",
          light: "#EDF1FD",
          dark: "#3B5BDB",
        },

        emerald: {
          DEFAULT: "#059669",
          light: "#ECFDF5",
          dark: "#047857",
        },

        // THE accent. Deep blue; used for primary actions, links, focus.
        cobalt: {
          DEFAULT: "#3B5BDB",
          light: "#EDF1FD",
          dark: "#2B44A8",
        },

        status: {
          success: "#059669",
          "success-bg": "#ECFDF5",
          warning: "#B45309",
          "warning-bg": "#FFFBEB",
          danger: "#DC2626",
          "danger-bg": "#FEF2F2",
          neutral: "#565B66",
          "neutral-bg": "#F4F5F6",
        },
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-ui)"],
        body: ["var(--font-ui)"],
      },
      letterSpacing: {
        display: "-0.02em",
        "display-tight": "-0.03em",
      },
      borderColor: {
        DEFAULT: "var(--border)",
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        md: "10px",
        lg: "12px",
      },
      boxShadow: {
        // Soft, layered, barely-there — outlines come from spacing, not ink.
        card: "0 1px 2px rgba(16,24,40,0.05), 0 1px 3px rgba(16,24,40,0.06)",
        lift: "0 4px 12px rgba(16,24,40,0.08), 0 2px 4px rgba(16,24,40,0.04)",
        overlay: "0 24px 48px -12px rgba(16,24,40,0.18)",
        "focus-ring": "0 0 0 2px #FFFFFF, 0 0 0 4px #3B5BDB",
      },
    },
  },
  plugins: [],
};

export default config;
