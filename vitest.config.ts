import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    exclude: ['e2e/**', 'tests/**', 'node_modules/**'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/App.jsx', 'src/App_old.js', 'tests/', 'e2e/', 'dist/'],
      // Untergrenzen = aktueller Ist-Stand; neue Features dürfen die Quote nicht senken
      thresholds: {
        statements: 30,
        lines: 30,
        functions: 58,
        branches: 78,
      },
    },
  },
});