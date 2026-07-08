import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { eq, inArray } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { requireEnv } from './env';
import { users, loginAttempts } from '../lib/db/schema';
import { hashPassword } from '../lib/auth/password';

// Read from the same SEED_OWNER_EMAIL/PASSWORD that lib/db/seed.ts consumed to create
// this account — not hardcoded — so this file runs unchanged against any environment
// (local `dev` branch, CI's `ci` branch) regardless of which actual credentials each
// one seeds.
const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');
const VIEWER_EMAIL = 'e2e-viewer@example.com';
const VIEWER_PASSWORD = 'viewer-password-123';
// A dedicated, non-existent identity for the wrong-password test — deliberately NOT
// the real owner. loginAction returns the same generic error either way, so this
// doesn't need to be a real account, and using one avoids polluting the owner's own
// login_attempts rate-limit bucket every time this suite runs (previously, running
// this file repeatedly during development pushed the owner past the 5-failure/15-min
// threshold, then made the *legitimate* login test fail too — a real, reproducible
// test-isolation bug, not a flake).
const WRONG_PASSWORD_PROBE_EMAIL = 'e2e-wrong-password-probe@example.com';

const { db: testDb, close: closeTestDb } = createTestDb();

test.describe('auth', () => {
  // These tests share one DB fixture (a viewer user created once in beforeAll) and
  // mutate shared server-side state (login sessions). With the config's
  // `fullyParallel: true`, Playwright can otherwise shard this file's tests across
  // multiple workers, running beforeAll more than once — serial mode keeps this file
  // on one worker, matching how the Vitest integration project already handles the
  // same class of shared-DB-state hazard (fileParallelism: false).
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    // Reuse the seeded owner's real household so this viewer fixture is a genuine
    // household member, not an orphaned row with a dangling household_id.
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
      name: 'E2E Viewer',
      role: 'viewer',
    });

    // Clear any accumulated rate-limit history for the identities this file exercises,
    // so a login test's outcome never depends on how many times the suite happened to
    // run recently.
    await testDb
      .delete(loginAttempts)
      .where(inArray(loginAttempts.email, [OWNER_EMAIL, VIEWER_EMAIL, WRONG_PASSWORD_PROBE_EMAIL]));
  });

  test.afterAll(async () => {
    await testDb.delete(users).where(eq(users.email, VIEWER_EMAIL));
    await testDb
      .delete(loginAttempts)
      .where(inArray(loginAttempts.email, [OWNER_EMAIL, VIEWER_EMAIL, WRONG_PASSWORD_PROBE_EMAIL]));
    await closeTestDb();
  });

  test('unauthenticated request to a protected route redirects to /login', async ({ page }) => {
    await page.goto('/settings/members');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logging in reaches the dashboard, and logging out returns to /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByText(/Welcome, /)).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('wrong password shows a generic error and does not navigate away', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(WRONG_PASSWORD_PROBE_EMAIL);
    await page.getByLabel('Password').fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid email or password.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a viewer cannot reach member management even by navigating there directly', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(VIEWER_EMAIL);
    await page.getByLabel('Password').fill(VIEWER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    // The sidebar doesn't even link to Members for a non-owner...
    await expect(page.getByRole('link', { name: 'Members' })).toHaveCount(0);

    // ...and navigating there directly is rejected server-side, not just hidden by the UI.
    await page.goto('/settings/members');
    await expect(page.getByText('Only the household owner can manage members.')).toBeVisible();
  });

  test('a tampered/garbage session cookie is treated as unauthenticated, not a crash', async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: 'session',
        value: 'not-a-real-session-token-just-garbage',
        url: 'http://localhost:3000',
      },
    ]);

    const response = await page.goto('/settings/members');
    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveURL(/\/login$/);
  });
});
