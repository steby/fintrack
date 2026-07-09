import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { eq, inArray } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { requireEnv } from './env';
import { recurringSchedule, monthlyEntries, users, categories } from '../lib/db/schema';
import { hashPassword } from '../lib/auth/password';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');
const VIEWER_EMAIL = 'e2e-monthly-viewer@example.com';
const VIEWER_PASSWORD = 'viewer-password-123';

const { db: testDb, close: closeTestDb } = createTestDb();

function currentMonthUrl(path = '/monthly') {
  const now = new Date();
  return `${path}?year=${now.getFullYear()}&month=${now.getMonth() + 1}&view=list`;
}

test.describe('monthly entries', () => {
  test.describe.configure({ mode: 'serial' });

  const itemName = `E2E Monthly Item ${Date.now()}`;
  // The test renames the recurring item mid-run (the propagate step) — cleanup must
  // match both names, or the renamed row leaks on every run (caught by seed.ts's
  // idempotency check unexpectedly counting leftover rows from a prior E2E run).
  const renamedItemName = `${itemName} propagated`;
  const adhocName = `E2E Adhoc ${Date.now()}`;
  const categoryName = `E2E Monthly Category ${Date.now()}`;

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
      passwordHash: await hashPassword(VIEWER_PASSWORD),
      name: 'E2E Monthly Viewer',
      role: 'viewer',
    });
    // The difference column (getDifference) needs a category direction to compute
    // anything — an item with no category is a valid but untestable-for-this-purpose
    // edge case (see list-view.tsx's "Uncategorized" section for that path instead).
    await testDb.insert(categories).values({
      householdId: owner.householdId,
      name: categoryName,
      direction: 'expense',
    });
  });

  test.afterAll(async () => {
    const items = await testDb
      .select({ id: recurringSchedule.id })
      .from(recurringSchedule)
      .where(inArray(recurringSchedule.item, [itemName, renamedItemName]));
    if (items.length > 0) {
      await testDb.delete(monthlyEntries).where(
        inArray(
          monthlyEntries.recurringScheduleId,
          items.map((i) => i.id),
        ),
      );
    }
    await testDb
      .delete(recurringSchedule)
      .where(inArray(recurringSchedule.item, [itemName, renamedItemName]));
    await testDb.delete(monthlyEntries).where(eq(monthlyEntries.item, adhocName));
    await testDb.delete(categories).where(eq(categories.name, categoryName));
    await testDb.delete(users).where(eq(users.email, VIEWER_EMAIL));
    await closeTestDb();
  });

  test('generate, enter an actual, status advances, override budget survives a later propagate, ad-hoc add/delete', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    // Create a Monthly recurring item and generate it for the current month.
    await page.goto('/recurring');
    await page.getByRole('button', { name: 'Add item' }).click();
    await page.getByPlaceholder('e.g. Spotify Duo').fill(itemName);
    await page.getByPlaceholder('0.00').fill('80.00');
    await page.locator('select[name="categoryId"]').selectOption({ label: `↓ ${categoryName}` });
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('recurring-row').filter({ hasText: itemName })).toBeVisible();

    await page.getByRole('button', { name: 'Generate forecast' }).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByText(/Generated \d+ entr(y|ies)\./)).toBeVisible();

    // Visit the current month in list view — the generated entry should be there,
    // status forecast (nothing actualized yet among at least this entry).
    await page.goto(currentMonthUrl());
    const row = page.getByTestId('entry-row').filter({ hasText: itemName });
    await expect(row).toBeVisible();

    // Enter an actual amount — auto-submits on change (matches the reference app's
    // inline-edit UX), and the entry should now show a computed difference.
    await row.locator('input[name="actualAmount"]').fill('75.00');
    await row.locator('input[name="actualAmount"]').blur();
    await expect(row.getByText('+$5.00')).toBeVisible();

    // Set the actual date too — previously there was no UI control for this at all
    // (updateActualAction always supported it; entry-row.tsx only ever echoed a hidden,
    // unchangeable value). Verified against the real DB via expect.poll, not by re-
    // reading the input's own value: the field is uncontrolled, so it keeps showing
    // whatever was typed regardless of whether the Server Action round trip has landed
    // yet — a toHaveValue check here would pass even if the submission never persisted
    // anything, unlike the amount case above, which waits on a value ('+$5.00') that
    // only appears once the server has actually responded.
    await row.locator('input[name="actualDate"]').fill('2026-01-15');
    await row.locator('input[name="actualDate"]').blur();
    await expect
      .poll(async () => {
        const [persisted] = await testDb
          .select({ actualDate: monthlyEntries.actualDate })
          .from(monthlyEntries)
          .where(eq(monthlyEntries.item, itemName));
        return persisted.actualDate;
      })
      .toBe('2026-01-15');

    // Override this month's budgeted amount — a Phase 2 addition beyond the reference
    // app, marking the row is_overridden so a later recurring-item propagate can't
    // silently clobber it.
    await row.getByRole('button', { name: '$80.00' }).click();
    const budgetInput = row.locator('input[name="budgetedAmount"]');
    await budgetInput.fill('90.00');
    await row.getByRole('button', { name: '✓' }).click();
    await expect(row.getByText('OVERRIDDEN')).toBeVisible();

    // Now propagate a name change from the recurring item — the overridden month's item
    // name must NOT change (shouldPropagate skips it), proving the UI round-trip and
    // the underlying propagation logic agree end to end, not just in isolation.
    await page.goto('/recurring');
    const recurringRow = page.getByTestId('recurring-row').filter({ hasText: itemName });
    await recurringRow.getByRole('button', { name: 'Edit' }).click();
    const editingRow = page.getByTestId('recurring-row').filter({ hasText: 'Save' });
    await editingRow.locator('input[name="item"]').fill(renamedItemName);
    await editingRow.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByTestId('recurring-row').filter({ hasText: renamedItemName }),
    ).toBeVisible();

    await page.goto(currentMonthUrl());
    await expect(page.getByTestId('entry-row').filter({ hasText: itemName })).toBeVisible();
    await expect(page.getByTestId('entry-row').filter({ hasText: renamedItemName })).toHaveCount(0);

    // Ad-hoc entry: add then delete.
    await page.getByRole('button', { name: 'Ad-hoc entry' }).click();
    await page.getByPlaceholder('e.g. Car Repair').fill(adhocName);
    await page.getByRole('button', { name: 'Add entry' }).click();
    const adhocRow = page.getByTestId('entry-row').filter({ hasText: adhocName });
    await expect(adhocRow).toBeVisible();
    await expect(adhocRow.getByText('AD-HOC')).toBeVisible();

    await adhocRow.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('entry-row').filter({ hasText: adhocName })).toHaveCount(0);
  });

  // Split out from the mega-test above (previously tacked onto its tail) — this is a
  // genuinely independent, read-only check (calendar/agenda views render without
  // crashing) that doesn't need any of the preceding test's mutation state, and
  // sharing that test's cumulative 30s timeout budget after 7+ prior UI interactions
  // made it a recurring source of CI flakiness (calendar-cell/agenda-URL timeouts).
  // Standalone, it gets its own full timeout instead of inheriting timing pressure
  // from everything that ran before it.
  test('calendar and agenda views render without crashing', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto(currentMonthUrl());
    await page.getByTestId('view-toggle-calendar').click();
    await expect(page.getByTestId('calendar-cell').first()).toBeVisible();
    await page.getByTestId('view-toggle-agenda').click();
    await expect(page).toHaveURL(/view=agenda/);
  });

  test('a viewer sees monthly entries read-only', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(VIEWER_EMAIL);
    await page.getByLabel('Password').fill(VIEWER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto(currentMonthUrl());
    await expect(page.getByRole('button', { name: 'Ad-hoc entry' })).toHaveCount(0);
    await expect(page.locator('input[name="actualAmount"]')).toHaveCount(0);
  });

  test('an invalid amount is rejected with a visible error (spec.md Phase 2 failure-path requirement)', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto(currentMonthUrl());
    await page.getByRole('button', { name: 'Ad-hoc entry' }).click();
    await page.getByPlaceholder('e.g. Car Repair').fill(`E2E Invalid Amount ${Date.now()}`);
    // 11 digits — a syntactically valid HTML5 <input type="number"> value (so the
    // browser's own min/step constraint validation doesn't intercept the submission
    // before it reaches the server), but one that overflows numeric(12,2)'s 10-digit
    // integer-part limit, which addAdhocAction's zod schema now rejects gracefully
    // instead of the Postgres "numeric field overflow" this used to crash with.
    await page.getByPlaceholder('0.00').fill('99999999999');
    await page.getByRole('button', { name: 'Add entry' }).click();

    await expect(page.getByText('Enter a valid, non-negative budgeted amount.')).toBeVisible();
  });
});
