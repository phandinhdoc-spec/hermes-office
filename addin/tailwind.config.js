/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  corePlugins: { preflight: false }, // we scope our own reset under .hx
  theme: {
    extend: {
      keyframes: {
        shimmer: { "0%": { backgroundPosition: "200% 0" }, "100%": { backgroundPosition: "-200% 0" } },
        dot: { "0%, 80%, 100%": { opacity: 0.25, transform: "translateY(0)" }, "40%": { opacity: 1, transform: "translateY(-2px)" } },
        pop: { "0%": { opacity: 0, transform: "translateY(4px)" }, "100%": { opacity: 1, transform: "none" } },
      },
      animation: { shimmer: "shimmer 2.2s linear infinite", pop: "pop .15s ease-out", dot: "dot 1.2s ease-in-out infinite" },
    },
  },
  plugins: [],
};
