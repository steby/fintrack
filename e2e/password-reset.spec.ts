import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { requireEnv } from './env';
import { users, passwordResetTokens, loginAttempts } from '../lib/db/schema';
import { hashPassword } from '../lib/auth/password';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
// Dedicated throwaway user — NEVER the seed owner: every other spec logs in as the
// owner, and this flow *changes the account password*, which would cascade failures
// through the rest of the run if it ever leaked.
const RESET_EMAIL = 'e2e-password-reset@example.com';
const OLD_PASSWORD = 'reset-flow-old-pass-1';
const NEW_PASSWORD = 'reset-flow-new-pass-2';

const { db: testDb, close: closeTestDb } = createTestDb();

test.describe('password reset', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const [owner] = await testDb
      .select({ householdId: users.householdId })
      .from(users)
      .where(eq(users.email, OWNER_EMAIL))
      .limit(1);

    await testDb.delete(users).where(eq(users.email, RESET_EMAIL));
    await testDb.insert(users).values({
      householdId: owner.householdId,
      email: RESET_EMAIL,
      passwordHash: await hashPassword(OLD_PASSWORD),
      name: 'E2E Reset User',
      role: 'member',
    });
    // Same isolation rule as auth.spec's beforeAll: this test deliberately makes ONE
    // failed login (the dead old password), and each run/retry within the 15-minute
    // window accumulates toward RESET_EMAIL's rate-limit bucket — without this clear,
    // back-to-back suite runs push it past the 5-failure cap and the final
    // new-password login gets "Too many attempts" instead of succeeding (observed for
    // real, not hypothetical).
    await testDb.delete(loginAttempts).where(eq(loginAttempts.email, RESET_EMAIL));
  });

  test.afterAll(async () => {
    // password_reset_tokens rows cascade with the user delete.
    await testDb.delete(users).where(eq(users.email, RESET_EMAIL));
    await testDb.delete(loginAttempts).where(eq(loginAttempts.email, RESET_EMAIL));
    await closeTestDb();
  });

  test('request -> emailed link (read from DB) -> new password -> auto-login; old password and link are both dead', async ({
    page,
  }) => {
    // Request the reset from the public form.
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.getByLabel('Email').fill(RESET_EMAIL);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(/a reset link is on its way/i)).toBeVisible();

    // The DB stores only the HASH, so the raw token can't be read back — E2E runs
    // keys-optional (the link is logged, not emailed), so plant a known token the same
    // way the action would have. This still exercises everything that matters end to
    // end: the /reset/[token] page, resetPasswordAction's hash lookup, single-use
    // claim, session revocation, and auto-login.
    const [resetUser] = await testDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, RESET_EMAIL))
      .limit(1);
    const rows = await testDb
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, resetUser.id));
    expect(rows.length).toBeGreaterThanOrEqual(1); // the request above really minted one

    const { generateToken, hashToken } = await import('../lib/auth/token');
    const { newResetExpiry } = await import('../lib/auth/password-reset-rules');
    const plantedToken = generateToken();
    await testDb.insert(passwordResetTokens).values({
      userId: resetUser.id,
      tokenHash: hashToken(plantedToken),
      expiresAt: newResetExpiry(),
    });

    // Consume the link.
    await page.goto(`/reset/${plantedToken}`);
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Set new password' }).click();
    // Auto-login lands on Home, already authenticated.
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    // The link is single-use: replaying it must fail with the generic message.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto(`/reset/${plantedToken}`);
    await page.getByLabel('New password').fill('another-pass-entirely-3');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();

    // Old password dead, new password works. Both fields are refilled each attempt —
    // React 19 resets uncontrolled form fields after every action submit, so the email
    // from the failed attempt does NOT survive into the next one.
    await page.goto('/login');
    await page.getByLabel('Email').fill(RESET_EMAIL);
    await page.getByLabel('Password').fill(OLD_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid email or password.')).toBeVisible();

    await page.getByLabel('Email').fill(RESET_EMAIL);
    await page.getByLabel('Password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');
  });
});
