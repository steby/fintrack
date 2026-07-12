import 'dotenv/config';
import { test, expect, devices } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { requireEnv } from './env';
import { login } from './login';
import { createTestDb } from './test-db';
import { monthlyEntries } from '../lib/db/schema';

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

    await nav.getByRole('link', { name: 'Money' }).tap();
    await expect(page).toHaveURL(/\/monthly/);

    await nav.getByRole('link', { name: 'Net worth' }).tap();
    await expect(page).toHaveURL(/\/accounts/);

    await nav.getByRole('link', { name: 'Goals' }).tap();
    await expect(page).toHaveURL(/\/goals/);

    await nav.getByRole('link', { name: 'More' }).tap();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await nav.getByRole('link', { name: 'Home' }).tap();
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

// Phase 10: the global quick-add FAB (mobile's ONLY entry point to ad-hoc entry — the
// desktop "New entry" header button is `md:hidden`'s complement) and the
// agenda-by-default view preference. A separate describe block (own item name +
// cleanup) rather than folding into the block above — these tests create real
// monthly_entries rows the read-only nav tests above don't.
test.describe('mobile viewport: quick-add FAB and agenda default', () => {
  const { db: testDb, close: closeTestDb } = createTestDb();
  const fabItemName = `E2E Mobile FAB ${Date.now()}`;

  test.afterAll(async () => {
    await testDb.delete(monthlyEntries).where(eq(monthlyEntries.item, fabItemName));
    await closeTestDb();
  });

  test('agenda is the default Monthly view with no view param and no cookie', async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/monthly');
    await expect(page.getByTestId('view-toggle').getByTestId('view-toggle-agenda')).toHaveAttribute(
      'data-active',
      '',
    );
  });

  test('the FAB opens a bottom Drawer sheet; quick-add + one-tap mark-paid both work by touch', async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/monthly');

    // aria-label="New entry" (quick-add.tsx's Fab) — deliberately NOT "Add entry"/
    // "Add"/"Quick add"; this component is mounted on EVERY (app) page and a label
    // sharing the substring "add" broke a real, pre-existing E2E test elsewhere (see
    // quick-add.tsx's own comment). The desktop "New entry" button has `display:none`
    // below md (and vice versa above md), so exactly one of the two is ever reachable
    // via role queries at a given viewport regardless.
    const fab = page.getByRole('button', { name: 'New entry' });
    await expect(fab).toBeVisible();
    await fab.tap();

    const sheet = page.getByTestId('quick-add-form');
    await expect(sheet).toBeVisible();
    await sheet.getByPlaceholder('e.g. Car Repair').fill(fabItemName);
    // Leave the primary Amount field blank and set a budgeted amount via "More
    // options" — a real unpaid forecast row to exercise mark-paid against, same shape
    // as e2e/monthly.spec.ts's desktop equivalent.
    await sheet.getByRole('button', { name: 'More options' }).tap();
    await sheet.locator('input[name="budgetedAmount"]').fill('15.00');
    await sheet.getByRole('button', { name: 'Add entry' }).tap();

    // Ad-hoc, no scheduled day -> agenda's "No scheduled day" section, rendered as an
    // AgendaRow (calendar-view.tsx) with an inline Mark paid button for unpaid rows.
    const row = page.getByTestId('agenda-entry-row').filter({ hasText: fabItemName });
    await expect(row).toBeVisible();
    const markPaidButton = row.getByRole('button', { name: 'Mark paid' });
    await expect(markPaidButton).toBeVisible();
    await markPaidButton.tap();

    // post-redesign bug-fix pass: "Mark paid" now opens a small confirm popup (a
    // bottom Drawer at this viewport, same ResponsiveSheet primitive quick-add's own
    // sheet uses) with an editable date field defaulting to today, instead of
    // instantly marking paid — confirm by tapping the popup's own "Mark paid" button,
    // scoped to data-testid="mark-paid-form" since the trigger and the popup's submit
    // share the same label and briefly coexist while the popup is open.
    const markPaidForm = page.getByTestId('mark-paid-form');
    await expect(markPaidForm).toBeVisible();
    await markPaidForm.getByRole('button', { name: 'Mark paid' }).tap();
    await expect(markPaidButton).toHaveCount(0);

    // Verified against the real DB, not a re-read of any uncontrolled input's value —
    // see e2e/monthly.spec.ts's equivalent desktop test for why that's the right check.
    const persistedActual = async () => {
      const [persisted] = await testDb
        .select({ actualAmount: monthlyEntries.actualAmount })
        .from(monthlyEntries)
        .where(eq(monthlyEntries.item, fabItemName));
      if (!persisted) throw new Error(`No monthly_entries row found for "${fabItemName}"`);
      return persisted.actualAmount;
    };
    await expect.poll(persistedActual).toBe('15.00');
  });
});
