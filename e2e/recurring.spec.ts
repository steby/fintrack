import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { eq, and, inArray } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { requireEnv } from './env';
import { recurringSchedule, monthlyEntries, users, households } from '../lib/db/schema';
import { hashPassword } from '../lib/auth/password';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');
const VIEWER_EMAIL = 'e2e-recurring-viewer@example.com';
const VIEWER_PASSWORD = 'viewer-password-123';

const { db: testDb, close: closeTestDb } = createTestDb();

test.describe('recurring schedule', () => {
  test.describe.configure({ mode: 'serial' });

  const itemName = `E2E Recurring ${Date.now()}`;

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
      name: 'E2E Recurring Viewer',
      role: 'viewer',
    });
  });

  test.afterAll(async () => {
    const items = await testDb
      .select({ id: recurringSchedule.id })
      .from(recurringSchedule)
      .where(inArray(recurringSchedule.item, [itemName, `${itemName} renamed`]));
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
      .where(inArray(recurringSchedule.item, [itemName, `${itemName} renamed`]));
    await testDb.delete(users).where(eq(users.email, VIEWER_EMAIL));
    await closeTestDb();
  });

  test('create, generate a forecast, edit with propagate, and delete a recurring item', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/recurring');
    await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();

    // Create a Monthly item.
    await page.getByRole('button', { name: 'Add item' }).click();
    await page.getByPlaceholder('e.g. Spotify Duo').fill(itemName);
    await page.getByPlaceholder('0.00').fill('42.50');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const row = page.getByTestId('recurring-row').filter({ hasText: itemName });
    await expect(row).toBeVisible();
    await expect(row.getByText('$42.50')).toBeVisible();

    // Generate a forecast for the current month — the new item should materialize
    // into a monthly_entries row for it. Generate is a real modal Dialog now (spec.md
    // Phase 11: "Generate -> Dialog"), deliberately staying open after success to show
    // the "Generated N entries" message in place — unlike the pre-restyle inline form,
    // its backdrop blocks clicks elsewhere on the page until dismissed, so the test
    // must close it before continuing (caught live: the next step's Edit click
    // otherwise timed out waiting for an element the backdrop was intercepting).
    await page.getByRole('button', { name: 'Generate forecast' }).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByText(/Generated \d+ entr(y|ies)\./)).toBeVisible();
    // Dismiss via the dialog's own built-in close icon (components/ui/dialog.tsx's
    // DialogContent, aria-label="Close") — there's no separate footer "Close" button
    // (removed: it was a redundant, exact-name-colliding second way to do the same
    // thing — see generate-form.tsx's comment).
    await page.getByLabel('Close').click();
    await expect(page.getByLabel('Close')).toHaveCount(0);

    // The default generate range now spans a full 12 months forward (see
    // generate-form.tsx's addMonths-based default), so more than one month's entry
    // exists for this item — filter for the CURRENT month specifically rather than
    // taking an unordered "first" row, which could otherwise land on any month in the
    // range depending on Postgres's unspecified scan order.
    const now = new Date();
    const [generatedEntry] = await testDb
      .select()
      .from(monthlyEntries)
      .innerJoin(recurringSchedule, eq(monthlyEntries.recurringScheduleId, recurringSchedule.id))
      .where(
        and(
          eq(recurringSchedule.item, itemName),
          eq(monthlyEntries.year, now.getFullYear()),
          eq(monthlyEntries.month, now.getMonth() + 1),
        ),
      );
    expect(generatedEntry).toBeDefined();

    // Edit the item with propagate — the forecast entry should pick up the new name.
    await row.getByRole('button', { name: 'Edit' }).click();
    const renamedName = `${itemName} renamed`;
    const editingRow = page.getByTestId('recurring-row').filter({ hasText: 'Save' });
    await editingRow.locator('input[name="item"]').fill(renamedName);
    await editingRow.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('recurring-row').filter({ hasText: renamedName })).toBeVisible();

    const [propagatedEntry] = await testDb
      .select({ item: monthlyEntries.item })
      .from(monthlyEntries)
      .innerJoin(recurringSchedule, eq(monthlyEntries.recurringScheduleId, recurringSchedule.id))
      .where(eq(recurringSchedule.item, renamedName));
    expect(propagatedEntry.item).toBe(renamedName);

    // Toggle inactive, then delete (with its forecast entry). Active/Inactive is a
    // Switch primitive now (spec.md Phase 11), not a plain button — Base UI's Switch.Root
    // renders role="switch", not "button" (verified against the installed package's
    // source), so this asserts via toBeChecked()/not.toBeChecked() rather than a role
    // name that no longer applies.
    const renamedRow = page.getByTestId('recurring-row').filter({ hasText: renamedName });
    const activeToggle = renamedRow.getByRole('switch');
    await expect(activeToggle).toBeChecked();
    await activeToggle.click();
    await expect(activeToggle).not.toBeChecked();
    await expect(renamedRow.getByText('Inactive')).toBeVisible();

    await renamedRow.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('recurring-row').filter({ hasText: renamedName })).toHaveCount(0);

    const [deletedItem] = await testDb
      .select()
      .from(recurringSchedule)
      .where(eq(recurringSchedule.item, renamedName));
    expect(deletedItem).toBeUndefined();
  });

  test('a viewer sees the recurring schedule read-only', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(VIEWER_EMAIL);
    await page.getByLabel('Password').fill(VIEWER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/recurring');
    await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add item' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Generate forecast' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);
  });

  test('a brand-new household with zero recurring items sees the empty state', async ({ page }) => {
    const [freshHousehold] = await testDb
      .insert(households)
      .values({ name: `E2E Plan Empty ${Date.now()}` })
      .returning();
    const email = `e2e-plan-empty-${Date.now()}@example.com`;
    const password = 'fresh-household-password-123';

    try {
      await testDb.insert(users).values({
        householdId: freshHousehold.id,
        email,
        passwordHash: await hashPassword(password),
        name: 'Fresh Owner',
        role: 'owner',
      });

      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL('/');

      await page.goto('/recurring');
      await expect(page.getByText('No recurring items yet')).toBeVisible();
    } finally {
      await testDb.delete(users).where(eq(users.email, email));
      await testDb.delete(households).where(eq(households.id, freshHousehold.id));
    }
  });
});
