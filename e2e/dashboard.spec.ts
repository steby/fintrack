import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { requireEnv } from './env';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER_EMAIL);
  await page.getByLabel('Password').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

test.describe('dashboard', () => {
  test('a seeded year renders every widget without crashing', async ({ page }) => {
    await login(page);

    await expect(page.getByText(/Household overview for \d{4}/)).toBeVisible();
    // "Income"/"Expense" legitimately appear twice (stat tiles + the YoY card below) —
    // .first() just confirms the label renders somewhere, not a specific single instance.
    await expect(page.getByText('Income', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Expense', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Net', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Savings rate')).toBeVisible();
    await expect(page.getByText('Cash flow')).toBeVisible();
    await expect(page.getByText('Expense by category')).toBeVisible();
    await expect(page.getByText('Cumulative savings')).toBeVisible();
    await expect(page.getByText('Bank summary')).toBeVisible();
    await expect(page.getByText('Fixed vs. variable')).toBeVisible();
    await expect(page.getByText(/Year over year/)).toBeVisible();
  });

  test('an empty year (no entries) renders empty states, not a crash', async ({ page }) => {
    await login(page);
    await page.goto('/?year=2099');

    await expect(page.getByText('Household overview for 2099')).toBeVisible();
    await expect(page.getByText('No expense categories budgeted this year.')).toBeVisible();
    await expect(page.getByText('No entries linked to a bank account this year.')).toBeVisible();
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
    await login(page);
    const expectedText = `Household overview for ${new Date().getFullYear()}`;

    await page.goto('/?year=99999');
    await expect(page.getByText(expectedText)).toBeVisible();

    await page.goto('/?year=not-a-number');
    await expect(page.getByText(expectedText)).toBeVisible();
  });

  test('year picker navigates and the sidebar year links jump to the dashboard', async ({
    page,
  }) => {
    await login(page);
    const currentYear = new Date().getFullYear();

    await page.getByTestId('year-picker-prev').click();
    await expect(page).toHaveURL(`/?year=${currentYear - 1}`);

    await page
      .getByTestId('year-nav-link')
      .filter({ hasText: String(currentYear + 1) })
      .click();
    await expect(page).toHaveURL(`/?year=${currentYear + 1}`);
  });

  test('theme toggle switches and persists across reload', async ({ page }) => {
    await login(page);

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
