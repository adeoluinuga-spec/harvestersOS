import type { Config } from "tailwindcss";

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

        ink: {
          DEFAULT: "#070707",
          950: "#020202",
          900: "#070707",
          800: "#101010",
          700: "#1D1A17",
          600: "#302A24",
          500: "#4B443B",
          400: "#6B6258",
          300: "#958C80",
        },

        paper: {
          DEFAULT: "#FFFEFA",
          50: "#FFFDF7",
          100: "#F7F3EA",
          200: "#E9DFCF",
          300: "#D9CCBA",
        },

        silver: {
          DEFAULT: "#C8A96A",
          light: "#EADFCB",
          dark: "#9B7A36",
        },

        champagne: {
          DEFAULT: "#C8A96A",
          light: "#F3E7CD",
          dark: "#8C6722",
        },

        emerald: {
          DEFAULT: "#0D6B57",
          light: "#E7F2EF",
          dark: "#083F35",
        },

        cobalt: {
          DEFAULT: "#233F8F",
          light: "#E8ECFA",
          dark: "#14275C",
        },

        status: {
          success: "#0D6B57",
          "success-bg": "#E7F2EF",
          warning: "#8C6722",
          "warning-bg": "#F8F0DD",
          danger: "#8B2B2B",
          "danger-bg": "#F6EDED",
          neutral: "#4B443B",
          "neutral-bg": "#F2EDE4",
        },
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-ui)"],
        body: ["var(--font-ui)"],
      },
      letterSpacing: {
        display: "0",
        "display-tight": "0",
      },
      borderColor: {
        DEFAULT: "var(--border)",
      },
      borderRadius: {
        sm: "5px",
        DEFAULT: "7px",
        md: "8px",
        lg: "10px",
      },
      boxShadow: {
        card: "0 16px 45px rgba(20,16,10,0.10), 0 2px 8px rgba(20,16,10,0.08)",
        lift: "0 24px 70px rgba(10,10,10,0.18), 0 8px 18px rgba(200,169,106,0.10)",
        overlay: "0 28px 80px rgba(10,10,10,0.24)",
        "focus-ring": "0 0 0 2px #FFFEFA, 0 0 0 4px #C8A96A",
      },
    },
  },
  plugins: [],
};

export default config;
