import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  // Default per-assertion timeout is 5000ms — tight for a real login POST + Server
  // Action + redirect + full page load under CI resource contention (observed as an
  // occasional flake on auth.spec.ts's post-login toHaveURL check, recovered by CI's
  // own retries but worth tightening the margin rather than relying on retries alone).
  expect: {
    timeout: 10000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // CI runs `build` as its own pipeline step before E2E, so `start` reuses that
    // production build; locally, `dev` is faster to iterate against.
    command: process.env.CI ? 'npm run start' : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
