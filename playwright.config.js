import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60000,
  },
})
