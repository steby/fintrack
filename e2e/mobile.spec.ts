import 'dotenv/config';
import { test, expect, devices } from '@playwright/test';
import { requireEnv } from './env';
import { login } from './login';

// spec.md Phase 7: "mobile-viewport Playwright run of core flows." Scoped to this one
// file via test.use (not a whole new Playwright project in playwright.config.ts) — the
// rest of the suite doesn't care about viewport, and running everything twice would
// double CI time for no real coverage gain.
//
// Pixel 7 (Chromium), not an iPhone preset — this project only installs the chromium
// browser (playwright.config.ts, .github/workflows/ci.yml), and Playwright's iOS device
// presets default to the webkit engine. A real mobile viewport + touch input is what
// this file needs to test; the specific device brand isn't load-bearing.
test.use({ ...devices['Pixel 7'] });

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');

test.describe('mobile viewport: core flows', () => {
  test('bottom nav replaces the sidebar and reaches every primary section', async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);

    // The desktop sidebar (app/(app)/layout.tsx: `hidden md:flex`) must not take up
    // mobile layout space — this is the whole point of the bottom nav existing.
    await expect(page.locator('aside')).toBeHidden();

    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav).toBeVisible();

    await nav.getByRole('link', { name: 'Monthly' }).tap();
    await expect(page).toHaveURL(/\/monthly/);

    await nav.getByRole('link', { name: 'Recurring' }).tap();
    await expect(page).toHaveURL(/\/recurring/);

    await nav.getByRole('link', { name: 'Goals' }).tap();
    await expect(page).toHaveURL(/\/goals/);

    await nav.getByRole('link', { name: 'More' }).tap();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await nav.getByRole('link', { name: 'Dashboard' }).tap();
    await expect(page).toHaveURL('/');
  });

  test('the settings hub reaches sign-out, and a mobile sign-out returns to /login', async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/settings');

    await page.getByRole('link', { name: 'Account', exact: true }).tap();
    await expect(page).toHaveURL(/\/settings\/account/);

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Sign out' }).tap();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('failure path: an unauthenticated mobile visit redirects to /login, not a broken layout', async ({
    page,
  }) => {
    await page.goto('/monthly');
    await expect(page).toHaveURL(/\/login$/);
    // The login form itself must render usably at this viewport (a real failure mode
    // this guards against: a layout regression that only breaks below md).
    await expect(page.getByLabel('Email')).toBeVisible();
  });
});
