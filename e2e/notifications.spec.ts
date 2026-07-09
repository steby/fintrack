import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { eq, and, inArray } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { requireEnv } from './env';
import { users, householdSettings } from '../lib/db/schema';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');
const MEMBER_EMAIL = 'e2e-phase6-member@example.com';
const MEMBER_PASSWORD = 'member-password-123';

const { db: testDb, close: closeTestDb } = createTestDb();

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

test.describe('Phase 6: notification settings', () => {
  test.describe.configure({ mode: 'serial' });

  let householdId: string;

  test.beforeAll(async () => {
    const [owner] = await testDb
      .select({ householdId: users.householdId })
      .from(users)
      .where(eq(users.email, OWNER_EMAIL))
      .limit(1);
    householdId = owner.householdId;

    // Start from the documented defaults regardless of what a prior run left behind.
    await testDb
      .delete(householdSettings)
      .where(
        and(
          eq(householdSettings.householdId, householdId),
          inArray(householdSettings.key, ['email_reminders', 'monthly_recap']),
        ),
      );
    await testDb
      .update(users)
      .set({ notifyByEmail: false })
      .where(eq(users.householdId, householdId));

    const { hashPassword } = await import('../lib/auth/password');
    await testDb.delete(users).where(eq(users.email, MEMBER_EMAIL));
    await testDb.insert(users).values({
      householdId,
      email: MEMBER_EMAIL,
      passwordHash: await hashPassword(MEMBER_PASSWORD),
      name: 'E2E Phase6 Member',
      role: 'member',
    });
  });

  test.afterAll(async () => {
    await testDb
      .delete(householdSettings)
      .where(
        and(
          eq(householdSettings.householdId, householdId),
          inArray(householdSettings.key, ['email_reminders', 'monthly_recap']),
        ),
      );
    await testDb
      .update(users)
      .set({ notifyByEmail: false })
      .where(eq(users.householdId, householdId));
    await testDb.delete(users).where(eq(users.email, MEMBER_EMAIL));
    await closeTestDb();
  });

  test('owner can toggle both kill-switches and the change persists across reload', async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/settings/notifications');

    await expect(page.getByRole('button', { name: 'Off' })).toHaveCount(2);

    await page.getByRole('button', { name: 'Off' }).first().click();
    await expect(page.getByRole('button', { name: 'On' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Off' }).first().click();
    await expect(page.getByRole('button', { name: 'On' })).toHaveCount(2);

    await page.reload();
    await expect(page.getByRole('button', { name: 'On' })).toHaveCount(2);
  });

  test('a member can self-opt-in but cannot manage the kill-switches (permission boundary)', async ({
    page,
  }) => {
    await login(page, MEMBER_EMAIL, MEMBER_PASSWORD);
    await page.goto('/settings/notifications');

    // Owner-only kill-switches render as a read-only badge, not a clickable toggle, for
    // a member — spec.md: "kill-switch toggles (owner-only)".
    await expect(page.getByRole('button', { name: 'Off' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'On' })).toHaveCount(0);
    await expect(
      page.getByText('Only the household owner can turn these on or off.'),
    ).toBeVisible();

    // Self-service opt-in still works regardless of role (spec.md: "recipient opt-in
    // per member").
    await expect(page.getByRole('button', { name: 'Not emailing you' })).toBeVisible();
    await page.getByRole('button', { name: 'Not emailing you' }).click();
    await expect(page.getByRole('button', { name: 'Emailing you' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Emailing you' })).toBeVisible();
  });
});
