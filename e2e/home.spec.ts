import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { requireEnv } from './env';
import { login } from './login';
import { households, users, categories, monthlyEntries } from '../lib/db/schema';
import { currentYearMonth } from '../lib/domain/today';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');
const VIEWER_EMAIL = 'e2e-home-viewer@example.com';
const VIEWER_PASSWORD = 'viewer-password-123';

const { db: testDb, close: closeTestDb } = createTestDb();

// Parses a formatSGD-rendered figure ("$1,234.56" / "-$5.00") back to integer cents —
// the same convention e2e specs already avoid page-wide text matches on raw amounts
// (WISDOM: "scope locators to testid containers"); this always operates on text already
// scoped to a single testid container, never the whole page.
function parseSGDToCents(text: string): number {
  const match = text.match(/-?\$[\d,]+\.\d{2}/);
  if (!match) throw new Error(`No SGD amount found in: ${JSON.stringify(text)}`);
  return Math.round(parseFloat(match[0].replace(/[$,]/g, '')) * 100);
}

test.describe('Home: forecast-first affordability', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const [owner] = await testDb
      .select({ householdId: users.householdId })
      .from(users)
      .where(eq(users.email, OWNER_EMAIL))
      .limit(1);

    await testDb.delete(users).where(eq(users.email, VIEWER_EMAIL));
    await testDb.insert(users).values({
      householdId: owner.householdId,
      email: VIEWER_EMAIL,
      passwordHash: await (await import('../lib/auth/password')).hashPassword(VIEWER_PASSWORD),
      name: 'E2E Home Viewer',
      role: 'viewer',
    });
  });

  test.afterAll(async () => {
    await testDb.delete(users).where(eq(users.email, VIEWER_EMAIL));
    await closeTestDb();
  });

  test('the hero renders a safe-to-spend or budget-remaining figure, not a crash', async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    // Visiting /monthly first guarantees the current+next-month auto-generate hook has
    // run (app/(app)/monthly/page.tsx) — Home itself never generates entries, it only
    // reads whatever already exists.
    await page.goto('/monthly');
    await page.goto('/');

    const hero = page
      .locator('[data-testid="safe-to-spend-value"], [data-testid="budget-left-value"]')
      .first();
    await expect(hero).toBeVisible();
    expect(await hero.innerText()).toMatch(/\$[\d,]+\.\d{2}/);
  });

  test('marking a seeded unpaid bill paid removes it from the list, drops the budget-left figure, and Undo restores both', async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/monthly'); // ensure current-month entries exist

    const [owner] = await testDb
      .select({ householdId: users.householdId })
      .from(users)
      .where(eq(users.email, OWNER_EMAIL))
      .limit(1);
    const itemName = `E2E Home Bill ${Date.now()}`;
    const [category] = await testDb
      .insert(categories)
      .values({
        householdId: owner.householdId,
        name: `E2E Home Category ${Date.now()}`,
        direction: 'expense',
      })
      .returning();
    const { year, month } = currentYearMonth();
    const [entry] = await testDb
      .insert(monthlyEntries)
      .values({
        householdId: owner.householdId,
        year,
        month,
        item: itemName,
        categoryId: category.id,
        budgetedAmount: '37.00',
      })
      .returning();

    try {
      await page.goto('/');
      const row = page.getByTestId('upcoming-item').filter({ hasText: itemName });
      await expect(row).toBeVisible();

      const budgetLeft = page.getByTestId('budget-left-value');
      const beforeCents = parseSGDToCents(await budgetLeft.innerText());

      // post-redesign bug-fix pass: "Mark paid" now opens a small confirm popup with an
      // editable date field (defaulting to today) instead of instantly marking paid —
      // the trigger and the popup's own submit button share the label "Mark paid" and
      // briefly coexist once the popup is open, so the confirm click is scoped to
      // data-testid="mark-paid-form" (same disambiguation approach as
      // goal-add-form.tsx's own trigger/submit-share-a-label pattern).
      await row.getByRole('button', { name: 'Mark paid' }).click();
      const markPaidForm = page.getByTestId('mark-paid-form');
      await expect(markPaidForm).toBeVisible();
      await markPaidForm.getByRole('button', { name: 'Mark paid' }).click();
      await expect(page.getByText(`Marked "${itemName}" paid`)).toBeVisible();
      await expect(row).toHaveCount(0);

      const afterCents = parseSGDToCents(await budgetLeft.innerText());
      expect(beforeCents - afterCents).toBe(3700);

      await page.getByRole('button', { name: 'Undo' }).click();
      await page.reload();

      await expect(page.getByTestId('upcoming-item').filter({ hasText: itemName })).toBeVisible();
      const restoredCents = parseSGDToCents(
        await page.getByTestId('budget-left-value').innerText(),
      );
      expect(restoredCents).toBe(beforeCents);
    } finally {
      await testDb.delete(monthlyEntries).where(eq(monthlyEntries.id, entry.id));
      await testDb.delete(categories).where(eq(categories.id, category.id));
    }
  });

  test('a viewer sees the upcoming list but no mark-paid button or horizon picker', async ({
    page,
  }) => {
    await login(page, VIEWER_EMAIL, VIEWER_PASSWORD);
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Mark paid' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Forecast horizon' })).toHaveCount(0);
  });

  test('a brand-new household with zero entries sees the empty state with a "set up your plan" CTA', async ({
    page,
  }) => {
    const { hashPassword } = await import('../lib/auth/password');
    const [freshHousehold] = await testDb
      .insert(households)
      .values({ name: `E2E Home Empty ${Date.now()}` })
      .returning();
    const email = `e2e-home-empty-${Date.now()}@example.com`;
    const password = 'fresh-household-password-123';

    try {
      await testDb.insert(users).values({
        householdId: freshHousehold.id,
        email,
        passwordHash: await hashPassword(password),
        name: 'Fresh Owner',
        role: 'owner',
      });

      await login(page, email, password);
      await expect(page.getByText('Nothing on the books yet')).toBeVisible();
      // The empty state is now the guided onboarding checklist (review finding #9) —
      // real-state-driven steps, each an actual link. This fresh household has no
      // accounts/categories/recurring items, so every step renders as an open link.
      const recurringStep = page.getByRole('link', { name: /Add recurring bills & income/ });
      await expect(recurringStep).toBeVisible();
      await expect(recurringStep).toHaveAttribute('href', '/recurring');
      const accountsStep = page.getByRole('link', { name: /Add your bank accounts/ });
      await expect(accountsStep).toHaveAttribute('href', '/settings/categories');
    } finally {
      await testDb.delete(users).where(eq(users.email, email));
      await testDb.delete(households).where(eq(households.id, freshHousehold.id));
    }
  });
});
