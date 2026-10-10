/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    // jsx/tsx explizit: Dialoge & Overlays nutzen Tailwind-Utilities (fixed inset-0,
    // z-*, flex ...) direkt in JSX – ohne jsx-Glob bleibt das CSS dafür ungeneriert.
    "./src/**/*.{html,js,jsx}",
    "./*.{html,js,jsx}"
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}