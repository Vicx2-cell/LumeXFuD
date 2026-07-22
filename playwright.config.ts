import { defineConfig, devices } from 'playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  timeout: 45_000,
  globalTimeout: 120_000,
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
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3187',
    url: 'http://127.0.0.1:3187',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PLAYWRIGHT_COMMERCE_FIXTURE: '1',
      JWT_SECRET: 'playwright-commerce-fixture-secret-000000000000000000000000',
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3187',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'playwright-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'playwright-service-role-key',
      SENTRY_DSN: '',
      NEXT_PUBLIC_SENTRY_DSN: '',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
})
