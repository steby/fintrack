import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { requireEnv } from './env';
import { login } from './login';
import { users } from '../lib/db/schema';
import { hashPassword } from '../lib/auth/password';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');
const VIEWER_EMAIL = 'e2e-shell-viewer@example.com';
const VIEWER_PASSWORD = 'viewer-password-123';

const { db: testDb, close: closeTestDb } = createTestDb();

// spec.md Phase 8: new sidebar/tab IA. Desktop sidebar reaches all 7 surfaces; theme
// toggle persists; a viewer sees no write affordances anywhere in the new shell.
test.describe('shell: navigation IA', () => {
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
      passwordHash: await hashPassword(VIEWER_PASSWORD),
      name: 'E2E Shell Viewer',
      role: 'viewer',
    });
  });

  test.afterAll(async () => {
    await testDb.delete(users).where(eq(users.email, VIEWER_EMAIL));
    await closeTestDb();
  });

  test('desktop sidebar reaches all 7 surfaces', async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);

    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    const surfaces: { label: string; urlPattern: RegExp }[] = [
      { label: 'Money', urlPattern: /\/monthly/ },
      { label: 'Plan', urlPattern: /\/recurring/ },
      { label: 'Net worth', urlPattern: /\/accounts/ },
      { label: 'Goals', urlPattern: /\/goals/ },
      { label: 'Insights', urlPattern: /\/insights/ },
      { label: 'Settings', urlPattern: /\/settings$/ },
    ];

    for (const { label, urlPattern } of surfaces) {
      await sidebar.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(urlPattern);
    }

    await sidebar.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL('/');
  });

  test('theme toggle persists across reload', async ({ page }) => {
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

  test('a viewer sees no Members link and no write affordances in the shell', async ({ page }) => {
    await login(page, VIEWER_EMAIL, VIEWER_PASSWORD);

    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();
    // Sidebar collapses to one Settings entry (Phase 8) — Members is only reachable
    // from inside the Settings hub, gated by can(role, 'manage_members'). A viewer must
    // never see it there either.
    await expect(sidebar.getByRole('link', { name: 'Members' })).toHaveCount(0);

    await page.goto('/settings');
    await expect(page.getByRole('link', { name: 'Members' })).toHaveCount(0);
    // Every other hub entry a viewer CAN read stays reachable — a missing Members link
    // isn't just every link vanishing.
    await expect(page.getByRole('link', { name: 'Categories & Accounts' })).toBeVisible();

    await page.goto('/');
    // No sign-out form or edit affordance anywhere in the shell chrome should require
    // write access — signing out and reading are both allowed for a viewer.
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});
