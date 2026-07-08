import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { requireEnv } from './env';
import { users, householdInvitations } from '../lib/db/schema';
import { generateToken } from '../lib/auth/token';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');

const { db: testDb, close: closeTestDb } = createTestDb();

test.describe('invite', () => {
  test.afterAll(async () => {
    await closeTestDb();
  });

  test('an expired invite link shows a friendly error, not a crash', async ({ page }) => {
    const [owner] = await testDb
      .select({ id: users.id, householdId: users.householdId })
      .from(users)
      .where(eq(users.email, OWNER_EMAIL))
      .limit(1);

    const token = generateToken();
    await testDb.insert(householdInvitations).values({
      householdId: owner.householdId,
      email: 'expired-invite@example.com',
      role: 'viewer',
      token,
      invitedByUserId: owner.id,
      expiresAt: new Date(Date.now() - 1000),
    });

    await page.goto(`/invite/${token}`);
    await expect(
      page.getByText('This invite link has expired. Ask the household owner to send a new one.'),
    ).toBeVisible();

    await testDb.delete(householdInvitations).where(eq(householdInvitations.token, token));
  });

  test('an invalid/unknown invite token shows a friendly error', async ({ page }) => {
    await page.goto('/invite/not-a-real-token');
    await expect(page.getByText('This invite link is invalid.')).toBeVisible();
  });

  test('accepting a fresh invite creates the user and logs them in', async ({ page }) => {
    const [owner] = await testDb
      .select({ id: users.id, householdId: users.householdId })
      .from(users)
      .where(eq(users.email, OWNER_EMAIL))
      .limit(1);

    const email = `e2e-invitee-${Date.now()}@example.com`;
    const token = generateToken();
    await testDb.insert(householdInvitations).values({
      householdId: owner.householdId,
      email,
      role: 'member',
      token,
      invitedByUserId: owner.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await page.goto(`/invite/${token}`);
    await page.getByLabel('Your name').fill('E2E Invitee');
    await page.getByLabel('Password').fill('a-fresh-password-123');
    await page.getByRole('button', { name: 'Join household' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByText('Welcome, E2E Invitee')).toBeVisible();

    // Replay: the same invite link must not be usable a second time, even by someone
    // who intercepted the URL before the real invitee opened it.
    await page.goto(`/invite/${token}`);
    await expect(page.getByText('This invite has already been used.')).toBeVisible();

    await testDb.delete(users).where(eq(users.email, email));
  });
});
