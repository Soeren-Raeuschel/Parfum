import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

/// <reference types="vitest" />

// https://vitejs.dev/config/#compiler-options
export default defineConfig({
  plugins: [
    react(),
    ...(process.env.ANALYZE === 'true'
      ? [visualizer({ filename: 'dist/stats.html', open: false, gzipSize: true })]
      : []),
  ],
  build: { target: 'esnext', sourcemap: 'hidden' }, // Sourcemaps werden gebaut, aber nicht referenziert/ausgeliefert → kleineres Asset-Volumen
  resolve: { alias: { '@': './src' } },
  // Dev-Proxy: /api-Requests (z. B. /api/groq, /api/parfum) an die lokale
  // Netlify-Functions-Runtime (`netlify dev`, Standard-Port 8888) weiterleiten,
  // damit der Vite-Dev-Server dieselben Endpunkte nutzt wie in Produktion.
  // Ziel überschreibbar: GROQ_PROXY_TARGET=http://localhost:9999 npm run dev
  server: {
    proxy: {
      '/api': {
        target: process.env.GROQ_PROXY_TARGET || 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    exclude: ['e2e/**', 'tests/**', 'node_modules/**'],
  },
})
