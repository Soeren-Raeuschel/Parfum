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
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    exclude: ['e2e/**', 'tests/**', 'node_modules/**'],
  },
})
