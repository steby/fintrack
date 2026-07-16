import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { eq, inArray } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { requireEnv } from './env';
import { login } from './login';
import {
  categories,
  bankAccounts,
  goals,
  users,
  households,
  monthlyEntries,
} from '../lib/db/schema';
import { currentYearMonth } from '../lib/domain/today';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');
const VIEWER_EMAIL = 'e2e-phase4-viewer@example.com';
const VIEWER_PASSWORD = 'viewer-password-123';

const { db: testDb, close: closeTestDb } = createTestDb();

test.describe('Phase 4: category budgets, goals, net worth', () => {
  test.describe.configure({ mode: 'serial' });

  const categoryName = `E2E Budget Category ${Date.now()}`;
  const goalName = `E2E Goal ${Date.now()}`;
  const accountName = `E2E NetWorth Account ${Date.now()}`;
  // Captured once the "overspend" test creates its ad-hoc entry, so afterAll can
  // delete that specific row by id (see the fix note below) rather than relying on
  // the category-delete cascade.
  let overspendEntryId: string | undefined;

  test.beforeAll(async () => {
    const [owner] = await testDb
      .select({ householdId: users.householdId })
      .from(users)
      .where(eq(users.email, OWNER_EMAIL))
      .limit(1);
    const { hashPassword } = await import('../lib/auth/password');
    await testDb.delete(users).where(eq(users.email, VIEWER_EMAIL));
    await testDb.insert(users).values({
      householdId: owner.householdId,
      email: VIEWER_EMAIL,
      passwordHash: await hashPassword(VIEWER_PASSWORD),
      name: 'E2E Phase4 Viewer',
      role: 'viewer',
    });
  });

  test.afterAll(async () => {
    // Fix (post-redesign bug-fix pass): monthlyEntries.categoryId has `onDelete:
    // 'set null'`, so deleting the category below ORPHANS the ad-hoc "overspend" entry
    // (categoryId -> null) instead of removing it — a real, silent debris leak into the
    // shared seed household on every run. Delete the entry itself FIRST, explicitly, by
    // the id captured when the test created it — don't rely on the category-delete
    // cascade to clean it up, since (as this bug demonstrates) there isn't one.
    if (overspendEntryId) {
      await testDb.delete(monthlyEntries).where(eq(monthlyEntries.id, overspendEntryId));
    }
    await testDb.delete(categories).where(eq(categories.name, categoryName));
    await testDb.delete(goals).where(inArray(goals.name, [goalName, `${goalName} renamed`]));
    await testDb.delete(bankAccounts).where(eq(bankAccounts.name, accountName));
    await testDb.delete(users).where(eq(users.email, VIEWER_EMAIL));
    await closeTestDb();
  });

  test('setting a category budget cap and overspending shows red', async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);

    await page.goto('/settings/categories');
    await page.getByPlaceholder('Category name').fill(categoryName);
    await page.getByPlaceholder('Budget cap').fill('50.00');
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();

    const row = page.getByTestId('category-row').filter({ hasText: categoryName });
    await expect(row).toBeVisible();
    // No spend yet this month — bar renders but nothing is over cap.
    await expect(row.getByText('$0.00 / $50.00 this month')).toBeVisible();

    // Add an ad-hoc entry against this category for the current month, over the cap, via
    // the Phase 10 global quick-add sheet (the per-page "Ad-hoc entry" button/form it
    // replaced is gone — spec.md Phase 10: "rename/refactor adhoc-form.tsx ->
    // quick-add.tsx"). List view specifically — a chip/row card view renders ad-hoc
    // entries without a data-testid="entry-row", which list view provides.
    const { year: nowYear, month: nowMonth } = currentYearMonth();
    await page.goto(`/monthly?year=${nowYear}&month=${nowMonth}&view=list`);
    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByPlaceholder('e.g. Car Repair').fill(`${categoryName} overspend`);
    await page.locator('select[name="categoryId"]').selectOption({ label: `↓ ${categoryName}` });
    // Quick-add's primary "Amount" field is actualAmount — addAdhocAction mirrors it
    // into budgetedAmount too when the "More options" budgeted field is left blank
    // (app/actions/monthly.ts's own comment), so this still produces the $75.00 spend
    // this assertion expects regardless of which of the two fields budgeting.ts reads.
    await page.getByPlaceholder('0.00').fill('75.00');
    await page.getByRole('button', { name: 'Add entry' }).click();
    await expect(
      page.getByTestId('entry-row').filter({ hasText: `${categoryName} overspend` }),
    ).toBeVisible();

    // Capture the created ad-hoc entry's id for afterAll's explicit cleanup (see its
    // own comment) — categoryId's `onDelete: 'set null'` means deleting the category
    // alone would orphan this row instead of removing it.
    const [overspendEntry] = await testDb
      .select({ id: monthlyEntries.id })
      .from(monthlyEntries)
      .where(eq(monthlyEntries.item, `${categoryName} overspend`));
    overspendEntryId = overspendEntry?.id;

    await page.goto('/settings/categories');
    const overspentRow = page.getByTestId('category-row').filter({ hasText: categoryName });
    await expect(overspentRow.getByText('$75.00 / $50.00 this month')).toBeVisible();

    await page.goto('/');
    await expect(
      page.getByTestId('budget-health-row').filter({ hasText: categoryName }),
    ).toBeVisible();
  });

  test('creating a goal renders progress, and a non-positive target is rejected', async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/goals');

    // Add via the ResponsiveSheet (spec.md Phase 11) — the trigger and the sheet's own
    // submit button share the label "Add goal" and coexist once the sheet is open, so
    // the submit is scoped to data-testid="goal-add-form" rather than disambiguated by
    // renaming either one (per the plan's own Playwright guidance).
    await page.getByRole('button', { name: 'Add goal' }).click();
    const addForm = page.getByTestId('goal-add-form');
    await addForm.getByPlaceholder('e.g. Emergency fund').fill(goalName);
    await addForm.getByPlaceholder('Target amount').fill('2000.00');
    await addForm.getByPlaceholder('Saved so far (optional)').fill('500.00');
    await addForm.getByRole('button', { name: 'Add goal' }).click();

    const card = page.getByTestId('goal-card').filter({ hasText: goalName });
    await expect(card).toBeVisible();
    await expect(card.getByText('25%')).toBeVisible();
    await expect(card.getByText('$500.00 of $2,000.00')).toBeVisible();

    // Wait for the sheet's own close animation to finish (Dialog/Drawer keep the Popup
    // mounted through their exit transition — components/ui/dialog.tsx's
    // `transition-all duration-150`) before re-opening it — without this, a real strict-
    // mode violation is possible (getByRole('button', { name: 'Add goal' }) briefly
    // resolving to both the trigger AND the still-animating-out submit button), caught
    // live running this exact test against a real production server, not a flaky guess.
    await expect(page.getByTestId('goal-add-form')).toHaveCount(0);

    // Failure path: a zero/negative target is rejected with a visible error, and the
    // sheet stays open (inline validation errors stay inline, not moved to a toast —
    // spec.md Phase 11) rather than closing as if it had succeeded.
    await page.getByRole('button', { name: 'Add goal' }).click();
    const addForm2 = page.getByTestId('goal-add-form');
    await addForm2.getByPlaceholder('e.g. Emergency fund').fill(`${goalName} invalid`);
    await addForm2.getByPlaceholder('Target amount').fill('0.00');
    await addForm2.getByRole('button', { name: 'Add goal' }).click();
    await expect(page.getByText('Enter a target amount greater than zero.')).toBeVisible();
    await expect(
      page.getByTestId('goal-card').filter({ hasText: `${goalName} invalid` }),
    ).toHaveCount(0);
  });

  test('editing a goal updates its progress', async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/goals');

    const card = page.getByTestId('goal-card').filter({ hasText: goalName });
    await card.getByRole('button', { name: 'Edit' }).click();
    const editForm = page.getByTestId('goal-edit-form');
    await editForm.locator('input[name="savedAmount"]').fill('2000.00');
    await editForm.getByRole('button', { name: 'Save' }).click();

    await expect(
      page.getByTestId('goal-card').filter({ hasText: goalName }).getByText('COMPLETE'),
    ).toBeVisible();
  });

  test('a brand-new household with zero goals sees the empty state', async ({ page }) => {
    const { hashPassword } = await import('../lib/auth/password');
    const [freshHousehold] = await testDb
      .insert(households)
      .values({ name: `E2E Goals Empty ${Date.now()}` })
      .returning();
    const email = `e2e-goals-empty-${Date.now()}@example.com`;
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
      await page.goto('/goals');
      await expect(page.getByText('No goals yet')).toBeVisible();
    } finally {
      await testDb.delete(users).where(eq(users.email, email));
      await testDb.delete(households).where(eq(households.id, freshHousehold.id));
    }
  });

  test('a brand-new household with zero categories/accounts sees the empty states', async ({
    page,
  }) => {
    const { hashPassword } = await import('../lib/auth/password');
    const [freshHousehold] = await testDb
      .insert(households)
      .values({ name: `E2E Categories Empty ${Date.now()}` })
      .returning();
    const email = `e2e-categories-empty-${Date.now()}@example.com`;
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
      await page.goto('/settings/categories');
      await expect(page.getByText('No income categories yet')).toBeVisible();
      await expect(page.getByText('No expense categories yet')).toBeVisible();
      await expect(page.getByText('No accounts yet')).toBeVisible();
    } finally {
      await testDb.delete(users).where(eq(users.email, email));
      await testDb.delete(households).where(eq(households.id, freshHousehold.id));
    }
  });

  test('setting an opening balance updates the net-worth account balances', async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);

    await page.goto('/settings/categories');
    await page.getByPlaceholder('Account name').fill(accountName);
    await page.getByPlaceholder('Opening balance').fill('1234.56');
    await page.getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(page.getByTestId('account-row').filter({ hasText: accountName })).toBeVisible();

    // AccountBalancesTable moved to /accounts in Phase 8 and, as of Phase 9's Home
    // rewrite, no longer renders on `/` at all (spec.md Phase 9: net-worth widgets are
    // canonical on /accounts only).
    await page.goto('/accounts');
    const balanceRow = page.getByTestId('account-balance-row').filter({ hasText: accountName });
    await expect(balanceRow).toBeVisible();
    await expect(balanceRow.getByText('$1,234.56')).toBeVisible();
  });

  test('a viewer sees goals read-only (no add/edit/delete controls)', async ({ page }) => {
    await login(page, VIEWER_EMAIL, VIEWER_PASSWORD);
    await page.goto('/goals');

    await expect(page.getByTestId('goal-card').filter({ hasText: goalName })).toBeVisible();
    await expect(page.getByPlaceholder('e.g. Emergency fund')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  });
  test('the net-worth "Learn more" sheet survives a viewport resize across the breakpoint', async ({
    page,
  }) => {
    // Regression (review finding): uncontrolled ResponsiveSheet usage never engaged the
    // breakpoint lock, so crossing 768px while open remounted Dialog<->Drawer with a
    // fresh (closed) internal state — the sheet silently vanished mid-read.
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/accounts');
    await page.getByRole('button', { name: 'Learn more' }).click();
    await expect(page.getByText('About net worth')).toBeVisible();

    await page.setViewportSize({ width: 500, height: 800 });
    await expect(page.getByText('About net worth')).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByText('About net worth')).toBeVisible();
  });
});
