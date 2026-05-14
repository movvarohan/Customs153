import type { Config } from "tailwindcss";

// Design tokens mirror the PDF renderer in src/core/lib/render-refund-pdf.ts
// so the on-screen and on-paper artifacts share an identity.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#0f2c4d", 50: "#f3f6fa", 100: "#e3eaf3", 200: "#c4d3e5", 700: "#1a3c66", 800: "#13335a", 900: "#0f2c4d" },
        accent: { DEFAULT: "#2a7f62", 50: "#f0f8f4", 100: "#d6ecde", 600: "#2a7f62", 700: "#226a52" },
        muted: "#4a4a4a",
        cardline: "#e6e6e6",
        warn: "#a83a3a",
        amber: "#b97a26",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Inter", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 44, 77, 0.04), 0 4px 12px rgba(15, 44, 77, 0.05)",
        focus: "0 0 0 3px rgba(42, 127, 98, 0.18)",
      },
      borderRadius: { card: "12px" },
    },
  },
  plugins: [],
};
export default config;
