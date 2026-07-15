import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { requireEnv } from './env';
import { login } from './login';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');

// Cross-month transaction search + the Insights donut drill-down that lands here
// (full app review findings #5/#6). Read-only over seeded data — no fixtures to clean.
test.describe('transactions search', () => {
  test('finds seeded entries by partial text and links each row to its month', async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);

    await page.goto('/transactions');
    // Pre-search empty state, not an error.
    await expect(page.getByText('Search your history')).toBeVisible();

    await page.getByLabel('Item').fill('mortgage');
    await page.getByRole('button', { name: 'Search' }).click();

    // The seed household has a monthly Mortgage recurring item generated across
    // multiple months — at least one row must match, newest first, each linking to
    // its own month's list view.
    const rows = page.getByRole('link', { name: /Mortgage/ });
    await expect(rows.first()).toBeVisible();
    const href = await rows.first().getAttribute('href');
    expect(href).toMatch(/^\/monthly\?year=\d{4}&month=\d{1,2}&view=list$/);

    // Nonsense search → the no-matches state, not a crash.
    await page.getByLabel('Item').fill('zzz-no-such-entry-zzz');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('No matches')).toBeVisible();
  });

  test('clicking an Insights donut legend entry drills down to the category-filtered search', async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);

    await page.goto('/insights');
    // The hand-rolled legend buttons are the deterministic drill-down target — a wide
    // sector's clickable center can land inside the donut hole (observed: Playwright's
    // click landed on the svg, not the arc), which is why the legend is real buttons.
    const legendItem = page.getByRole('button', { name: 'Housing' }).first();
    await expect(legendItem).toBeVisible();
    await legendItem.click();

    await expect(page).toHaveURL(/\/transactions\?category=[0-9a-f-]{36}$/);
    // The filter actually applied: results render (the seed's expense categories all
    // have generated entries) rather than the pre-search empty state.
    await expect(page.getByText('Search your history')).toHaveCount(0);
  });
});
