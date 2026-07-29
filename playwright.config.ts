import { defineConfig, devices } from 'playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  timeout: 45_000,
  // Seven viewport journeys run serially. The global budget must exceed their
  // combined per-test budget plus the first Turbopack compile on a clean CI host.
  globalTimeout: 300_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:3187',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { timeout: 20_000 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
})
