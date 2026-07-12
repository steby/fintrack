import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { login } from './login';
import { households, users, householdInvitations } from '../lib/db/schema';

const { db: testDb, close: closeTestDb } = createTestDb();

// spec.md Phase 11: Members restyled onto Card/primitives, "save feedback -> toasts"
// (InviteForm), and empty-state.tsx adopted on the "members-invites" list surface — the
// pre-restyle page never displayed pending invitations at all. A fresh household (not
// the shared seeded one) keeps this test's "no pending invites" assertion honest: a
// shared household could have leftover invites from a differently-timed run.
test.describe('members: pending invites', () => {
  test.afterAll(async () => {
    await closeTestDb();
  });

  test('a fresh household sees no pending invites until one is sent, then sees it listed', async ({
    page,
  }) => {
    const { hashPassword } = await import('../lib/auth/password');
    const [freshHousehold] = await testDb
      .insert(households)
      .values({ name: `E2E Members Empty ${Date.now()}` })
      .returning();
    const ownerEmail = `e2e-members-empty-owner-${Date.now()}@example.com`;
    const ownerPassword = 'fresh-household-password-123';
    const inviteEmail = `e2e-members-empty-invitee-${Date.now()}@example.com`;

    try {
      await testDb.insert(users).values({
        householdId: freshHousehold.id,
        email: ownerEmail,
        passwordHash: await hashPassword(ownerPassword),
        name: 'Fresh Owner',
        role: 'owner',
      });

      await login(page, ownerEmail, ownerPassword);
      await page.goto('/settings/members');
      await expect(page.getByText('No pending invites')).toBeVisible();

      // Send a real invite through the restyled InviteForm — confirms the toast fires
      // (direct-call + startTransition, not useActionState — see invite-form.tsx) and
      // the invite then shows up in the Pending invites list.
      await page.getByLabel('Email').fill(inviteEmail);
      await page.getByRole('button', { name: 'Send invite' }).click();
      await expect(page.getByText('Invite sent')).toBeVisible();

      const inviteRow = page.getByTestId('pending-invite-row').filter({ hasText: inviteEmail });
      await expect(inviteRow).toBeVisible();
      await expect(inviteRow.getByText('Pending')).toBeVisible();
    } finally {
      await testDb
        .delete(householdInvitations)
        .where(eq(householdInvitations.householdId, freshHousehold.id));
      await testDb.delete(users).where(eq(users.email, ownerEmail));
      await testDb.delete(households).where(eq(households.id, freshHousehold.id));
    }
  });
});
