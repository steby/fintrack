import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { requireEnv } from './env';
import { login } from './login';
import { currentYearMonth } from '../lib/domain/today';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');

// Renamed from dashboard.spec.ts (spec.md Phase 9): the year-analytics widgets this file
// asserts on moved off `/` in Phase 8 already; Phase 9 finally rewrites `/` itself (the
// forecast-first Home — see home.spec.ts), so every assertion here now targets
// `/insights`, the widgets' permanent home, instead of the old dashboard route.
test.describe('insights', () => {
  test('a seeded year renders every widget without crashing', async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/insights');

    await expect(page.getByText(/Year analytics for \d{4}/)).toBeVisible();
    // "Income"/"Expense" legitimately appear twice (stat tiles + the YoY card below) —
    // .first() just confirms the label renders somewhere, not a specific single instance.
    await expect(page.getByText('Income', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Expense', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Net', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Savings rate')).toBeVisible();
    await expect(page.getByText('Cash flow')).toBeVisible();
    await expect(page.getByText('Expense by category')).toBeVisible();
    await expect(page.getByText('Cumulative savings')).toBeVisible();
    await expect(page.getByText('Fixed vs. variable')).toBeVisible();
    await expect(page.getByText(/Year over year/)).toBeVisible();
  });

  test('an empty year (no entries) renders empty states, not a crash', async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/insights?year=2099');

    await expect(page.getByText('Year analytics for 2099')).toBeVisible();
    await expect(page.getByText('No expense categories budgeted this year.')).toBeVisible();
    await expect(page.getByText('No expenses recorded this year.')).toBeVisible();
    // Stat tiles show $0.00, not NaN/undefined, for a completely empty year.
    await expect(page.getByText('$0.00').first()).toBeVisible();
    await expect(page.getByText('NaN')).toHaveCount(0);
    // spec.md's "prev-year absent (YoY hides gracefully)" edge case — 2098 (this
    // year's prior) has no data either, so the YoY card must show its no-baseline
    // fallback text instead of a bogus 0%/NaN% delta.
    await expect(page.getByText('no prior year').first()).toBeVisible();
  });

  test('an out-of-range year param is clamped instead of crashing', async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    const expectedText = `Year analytics for ${currentYearMonth().year}`;

    await page.goto('/insights?year=99999');
    await expect(page.getByText(expectedText)).toBeVisible();

    await page.goto('/insights?year=not-a-number');
    await expect(page.getByText(expectedText)).toBeVisible();
  });

  // Phase 8's shell rewrite (app/(app)/layout.tsx) deleted the sidebar's YearNav
  // quick-jump entirely (spec.md Phase 8 task 4) — /insights' own in-page YearPicker
  // (`basePath="/insights"`, unaffected this phase) is the only year control left.
  test('year picker navigates within insights', async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/insights');
    const currentYear = currentYearMonth().year;

    await page.getByTestId('year-picker-prev').click();
    await expect(page).toHaveURL(`/insights?year=${currentYear - 1}`);

    await page.getByTestId('year-picker-next').click();
    await expect(page).toHaveURL(`/insights?year=${currentYear}`);
  });

  test('theme toggle switches and persists across reload', async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);

    const html = page.locator('html');
    const initiallyDark = await html.evaluate((el) => el.classList.contains('dark'));

    await page.getByTestId('theme-toggle').click();
    await expect
      .poll(() => html.evaluate((el) => el.classList.contains('dark')))
      .toBe(!initiallyDark);

    await page.reload();
    await expect
      .poll(() => html.evaluate((el) => el.classList.contains('dark')))
      .toBe(!initiallyDark);

    // Restore the original theme so this test doesn't leave persistent state that
    // affects a later run's "initiallyDark" assumption.
    await page.getByTestId('theme-toggle').click();
  });
});
