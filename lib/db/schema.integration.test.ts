import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './index';
import {
  households,
  users,
  sessions,
  householdInvitations,
  categories,
  recurringSchedule,
  monthlyEntries,
} from './schema';

// Deleting the household is enough cleanup for most of these tests — every other table
// here references households.id with onDelete: 'cascade', so removing the household
// removes its users/sessions/invitations/categories/etc. in one statement.
async function makeHousehold(name: string) {
  const [household] = await db.insert(households).values({ name }).returning();
  return household;
}

// drizzle-orm's node-postgres driver wraps the real pg error as `.cause`, not as the
// thrown error's own `.message` — `.rejects.toThrow(/unique/i)` checks the outer
// "Failed query: ..." message and never actually inspects the real reason, so it would
// pass even if the insert failed for a completely unrelated reason. Checking the
// wrapped error's SQLSTATE code (23505 = unique_violation) is what actually proves
// *why* it failed.
async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ cause: { code: '23505' } });
}

describe('schema constraints (real Postgres)', () => {
  it('enforces a unique email across users', async () => {
    const household = await makeHousehold('Test: unique email');
    const email = `dup-${Date.now()}@example.com`;
    await db.insert(users).values({
      householdId: household.id,
      email,
      passwordHash: 'x',
      name: 'A',
      role: 'owner',
    });

    await expectUniqueViolation(
      db.insert(users).values({
        householdId: household.id,
        email,
        passwordHash: 'x',
        name: 'B',
        role: 'member',
      }),
    );

    await db.delete(households).where(eq(households.id, household.id));
  });

  it('cascades: deleting a user deletes their sessions (removed member loses access immediately)', async () => {
    const household = await makeHousehold('Test: session cascade');
    const [user] = await db
      .insert(users)
      .values({
        householdId: household.id,
        email: `cascade-${Date.now()}@example.com`,
        passwordHash: 'x',
        name: 'C',
        role: 'owner',
      })
      .returning();
    await db.insert(sessions).values({
      id: `test-session-${Date.now()}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await db.delete(users).where(eq(users.id, user.id));

    const remaining = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(remaining).toHaveLength(0);

    await db.delete(households).where(eq(households.id, household.id));
  });

  it('enforces a unique invitation token', async () => {
    const household = await makeHousehold('Test: unique invite token');
    const [owner] = await db
      .insert(users)
      .values({
        householdId: household.id,
        email: `owner-${Date.now()}@example.com`,
        passwordHash: 'x',
        name: 'Owner',
        role: 'owner',
      })
      .returning();

    const token = `dup-token-${Date.now()}`;
    await db.insert(householdInvitations).values({
      householdId: household.id,
      email: 'a@example.com',
      role: 'viewer',
      token,
      invitedByUserId: owner.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expectUniqueViolation(
      db.insert(householdInvitations).values({
        householdId: household.id,
        email: 'b@example.com',
        role: 'viewer',
        token,
        invitedByUserId: owner.id,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );

    await db.delete(households).where(eq(households.id, household.id));
  });

  it('allows multiple ad-hoc monthly_entries (null recurring_schedule_id) in the same household/year/month without colliding', async () => {
    const household = await makeHousehold('Test: ad-hoc entries');

    await db.insert(monthlyEntries).values({
      householdId: household.id,
      year: 2026,
      month: 1,
      item: 'Ad-hoc 1',
      budgetedAmount: '0',
    });
    // Two NULL recurring_schedule_id values are never "equal" under Postgres's standard
    // unique-index semantics — this is exactly what allows many ad-hoc entries per
    // household/year/month (see lib/db/schema.ts's comment on this index). If this ever
    // throws, the index definition regressed.
    await expect(
      db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 1,
        item: 'Ad-hoc 2',
        budgetedAmount: '0',
      }),
    ).resolves.not.toThrow();

    await db.delete(households).where(eq(households.id, household.id));
  });

  it('rejects a second entry for the same recurring_schedule_id in the same household/year/month', async () => {
    const household = await makeHousehold('Test: duplicate recurring entry');
    const [category] = await db
      .insert(categories)
      .values({ householdId: household.id, name: 'Test', direction: 'expense' })
      .returning();
    const [recurring] = await db
      .insert(recurringSchedule)
      .values({ householdId: household.id, item: 'Rent', categoryId: category.id })
      .returning();

    await db.insert(monthlyEntries).values({
      householdId: household.id,
      year: 2026,
      month: 1,
      recurringScheduleId: recurring.id,
      item: 'Rent',
      budgetedAmount: '0',
    });

    await expectUniqueViolation(
      db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 1,
        recurringScheduleId: recurring.id,
        item: 'Rent (duplicate)',
        budgetedAmount: '0',
      }),
    );

    await db.delete(households).where(eq(households.id, household.id));
  });
});
