import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand colors
        brand: {
          primary: "var(--brand-primary)",
          secondary: "var(--brand-secondary)",
          warning: "var(--brand-warning)",
          danger: "var(--brand-danger)",
          info: "var(--brand-info)",
        },
        // Background colors
        bg: {
          primary: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          tertiary: "var(--bg-tertiary)",
          card: "var(--bg-card)",
          glass: "var(--glass-bg)",
          sidebar: "var(--bg-sidebar)",
          dashboard: "var(--bg-dashboard)",
        },
        // Border colors
        border: {
          subtle: "var(--border-subtle)",
          normal: "var(--border-normal)",
          strong: "var(--border-strong)",
          glass: "var(--glass-border)",
        },
        // Text colors
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          subtle: "var(--text-subtle)",
          inverse: "var(--text-inverse)",
        },
        // Legacy dark mode colors (for backward compatibility)
        "dark-bg": "var(--bg-primary)",
        "dark-card": "var(--bg-card)",
        "dark-lighter": "var(--bg-secondary)",
      },
      fontFamily: {
        sans: ["var(--font-ui)"],
        mono: ["var(--font-code)"],
        display: ["var(--font-display)"],
        logo: ["var(--font-logo)"],
      },
      borderRadius: {
        // Standard radius scale
        sm: "var(--radius-sm)",
        md: "var(--radius)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        "3xl": "var(--radius-3xl)",
        full: "var(--radius-full)",
        // Named radii
        card: "var(--radius-card)",
        button: "var(--radius-button)",
        input: "var(--radius-input)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        brand: "var(--shadow-brand)",
        "glow-cyan": "var(--shadow-glow-cyan)",
        "glow-emerald": "var(--shadow-glow-emerald)",
        "glow-danger": "var(--shadow-glow-danger)",
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
      },
      spacing: {
        // Extend with named spacing tokens
        "touch-target": "var(--size-touch-target)",
        "header": "var(--header-height)",
      },
      animation: {
        spin: "spin 1s linear infinite",
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        shimmer: "shimmer 2s infinite",
        fadeIn: "fadeIn 200ms ease-out",
        fadeOut: "fadeOut 200ms ease-in",
        scaleIn: "scaleIn 200ms ease-out",
      },
      keyframes: {
        spin: {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        fadeOut: {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        scaleIn: {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
