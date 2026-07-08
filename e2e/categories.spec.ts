import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { eq, inArray } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { requireEnv } from './env';
import { categories, bankAccounts, users } from '../lib/db/schema';
import { hashPassword } from '../lib/auth/password';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');
const VIEWER_EMAIL = 'e2e-categories-viewer@example.com';
const VIEWER_PASSWORD = 'viewer-password-123';

const { db: testDb, close: closeTestDb } = createTestDb();

test.describe('categories & accounts', () => {
  test.describe.configure({ mode: 'serial' });

  const categoryName = `E2E Category ${Date.now()}`;
  const renamedCategoryName = `${categoryName} renamed`;
  const accountName = `E2E Account ${Date.now()}`;
  // Exists purely so the viewer test below has something real to assert is VISIBLE
  // (read access works) while asserting NO controls render for it — without this, an
  // empty household would make the "no Edit/Delete buttons" check pass vacuously even
  // if the read-only gating were broken.
  const viewerFixtureCategoryName = `E2E Viewer Fixture Category ${Date.now()}`;

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
      name: 'E2E Categories Viewer',
      role: 'viewer',
    });
    await testDb.insert(categories).values({
      householdId: owner.householdId,
      name: viewerFixtureCategoryName,
      direction: 'expense',
    });
  });

  test.afterAll(async () => {
    await testDb
      .delete(categories)
      .where(
        inArray(categories.name, [categoryName, renamedCategoryName, viewerFixtureCategoryName]),
      );
    await testDb.delete(bankAccounts).where(eq(bankAccounts.name, accountName));
    await testDb.delete(users).where(eq(users.email, VIEWER_EMAIL));
    await closeTestDb();
  });

  test('a category can be created, edited, and deleted end to end', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/settings/categories');
    await expect(page.getByRole('heading', { name: 'Categories & accounts' })).toBeVisible();

    await page.getByPlaceholder('Category name').fill(categoryName);
    await page.getByRole('button', { name: 'Add' }).first().click();
    const row = page.getByTestId('category-row').filter({ hasText: categoryName });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Edit' }).click();
    const editingRow = page.getByTestId('category-row').filter({ hasText: 'Save' });
    await editingRow.locator('input[name="name"]').fill(renamedCategoryName);
    await editingRow.getByRole('button', { name: 'Save' }).click();
    const renamedRow = page.getByTestId('category-row').filter({ hasText: renamedCategoryName });
    await expect(renamedRow).toBeVisible();

    await renamedRow.getByRole('button', { name: 'Delete' }).click();
    await expect(
      page.getByTestId('category-row').filter({ hasText: renamedCategoryName }),
    ).toHaveCount(0);
  });

  test('a bank account can be created and deleted', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/settings/categories');
    await page.getByPlaceholder('Account name').fill(accountName);
    await page.getByRole('button', { name: 'Add' }).last().click();
    const row = page.getByTestId('account-row').filter({ hasText: accountName });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('account-row').filter({ hasText: accountName })).toHaveCount(0);
  });

  test('a viewer sees categories and accounts but no Add/Edit/Delete controls (server-enforced, not just hidden)', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(VIEWER_EMAIL);
    await page.getByLabel('Password').fill(VIEWER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/settings/categories');
    await expect(page.getByRole('heading', { name: 'Categories & accounts' })).toBeVisible();
    await expect(page.getByText(viewerFixtureCategoryName)).toBeVisible();
    await expect(page.getByPlaceholder('Category name')).toHaveCount(0);
    await expect(page.getByPlaceholder('Account name')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  });
});
