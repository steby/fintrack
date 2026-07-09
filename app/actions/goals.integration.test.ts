import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../lib/db';
import { goals } from '../../lib/db/schema';
import { makeHouseholdWithUser, formData, cleanup } from './test-helpers';

let mockToken: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'session' && mockToken ? { name, value: mockToken } : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

afterAll(async () => {
  await pool.end();
});

afterEach(() => {
  mockToken = undefined;
});

describe('createGoalAction', () => {
  it('a member can create a goal', async () => {
    const { createGoalAction } = await import('./goals');
    const member = await makeHouseholdWithUser('member', 'Goal create A');
    mockToken = member.token;

    const result = await createGoalAction(
      undefined,
      formData({ name: 'Emergency fund', targetAmount: '10000.00', savedAmount: '2500.00' }),
    );
    expect(result).toEqual({ success: true });

    const [row] = await db.select().from(goals).where(eq(goals.householdId, member.household.id));
    expect(row).toMatchObject({
      name: 'Emergency fund',
      targetAmount: '10000.00',
      savedAmount: '2500.00',
      targetDate: null,
    });

    await cleanup(member.household.id);
  });

  it('defaults savedAmount to 0 when omitted', async () => {
    const { createGoalAction } = await import('./goals');
    const member = await makeHouseholdWithUser('member', 'Goal create B');
    mockToken = member.token;

    await createGoalAction(undefined, formData({ name: 'New car', targetAmount: '20000.00' }));
    const [row] = await db.select().from(goals).where(eq(goals.householdId, member.household.id));
    expect(row.savedAmount).toBe('0.00');

    await cleanup(member.household.id);
  });

  it('rejects a negative or zero target amount', async () => {
    const { createGoalAction } = await import('./goals');
    const member = await makeHouseholdWithUser('member', 'Goal create C');
    mockToken = member.token;

    const zero = await createGoalAction(
      undefined,
      formData({ name: 'Nothing', targetAmount: '0.00' }),
    );
    expect(zero?.error).toBeTruthy();

    await cleanup(member.household.id);
  });

  it('rejects a malformed target date', async () => {
    const { createGoalAction } = await import('./goals');
    const member = await makeHouseholdWithUser('member', 'Goal create D');
    mockToken = member.token;

    const result = await createGoalAction(
      undefined,
      formData({ name: 'Trip', targetAmount: '5000.00', targetDate: '2026-02-30' }),
    );
    expect(result?.error).toBeTruthy();

    await cleanup(member.household.id);
  });

  it('a viewer cannot create a goal', async () => {
    const { createGoalAction } = await import('./goals');
    const viewer = await makeHouseholdWithUser('viewer', 'Goal create E');
    mockToken = viewer.token;

    await expect(
      createGoalAction(undefined, formData({ name: 'Trip', targetAmount: '5000.00' })),
    ).rejects.toThrow('You do not have permission to perform this action.');

    await cleanup(viewer.household.id);
  });

  it('rejects creating a goal when FEATURE_SAVINGS_GOALS is disabled (server-side, not just hidden UI)', async () => {
    vi.doMock('../../lib/env', () => ({ env: { FEATURE_SAVINGS_GOALS: false } }));
    vi.resetModules();
    // A code-review pass found this mock/unmock pair had no try/finally — a failing
    // assertion below would leave the mocked (nearly-empty) env module active for
    // every later test in the run, masking the real failure behind unrelated errors.
    try {
      const { createGoalAction } = await import('./goals');
      const member = await makeHouseholdWithUser('member', 'Goal create F');
      mockToken = member.token;

      const result = await createGoalAction(
        undefined,
        formData({ name: 'Trip', targetAmount: '5000.00' }),
      );
      expect(result).toEqual({ error: 'Savings goals are not enabled.' });

      const rows = await db.select().from(goals).where(eq(goals.householdId, member.household.id));
      expect(rows).toHaveLength(0);

      await cleanup(member.household.id);
    } finally {
      vi.doUnmock('../../lib/env');
      vi.resetModules();
    }
  });
});

describe('updateGoalAction', () => {
  it('updates saved amount and target date within the acting household', async () => {
    const { updateGoalAction } = await import('./goals');
    const member = await makeHouseholdWithUser('member', 'Goal update A');
    const [goal] = await db
      .insert(goals)
      .values({ householdId: member.household.id, name: 'Trip', targetAmount: '3000.00' })
      .returning();

    mockToken = member.token;
    const result = await updateGoalAction(
      undefined,
      formData({
        id: goal.id,
        name: 'Trip',
        targetAmount: '3000.00',
        savedAmount: '1500.00',
        targetDate: '2027-06-01',
      }),
    );
    expect(result).toEqual({ success: true });

    const [updated] = await db.select().from(goals).where(eq(goals.id, goal.id));
    expect(updated).toMatchObject({ savedAmount: '1500.00', targetDate: '2027-06-01' });

    await cleanup(member.household.id);
  });

  it('cannot update a goal in a DIFFERENT household (cross-tenant probe)', async () => {
    const { updateGoalAction } = await import('./goals');
    const memberA = await makeHouseholdWithUser('member', 'Goal update B-A');
    const memberB = await makeHouseholdWithUser('member', 'Goal update B-B');
    const [goalInB] = await db
      .insert(goals)
      .values({ householdId: memberB.household.id, name: 'B Goal', targetAmount: '1000.00' })
      .returning();

    mockToken = memberA.token;
    const result = await updateGoalAction(
      undefined,
      formData({ id: goalInB.id, name: 'Hijacked', targetAmount: '1.00' }),
    );
    expect(result).toEqual({ error: 'Goal not found.' });

    const [unchanged] = await db.select().from(goals).where(eq(goals.id, goalInB.id));
    expect(unchanged.name).toBe('B Goal');

    await cleanup(memberA.household.id, memberB.household.id);
  });
});

describe('deleteGoalAction', () => {
  it('deletes a goal within the acting household', async () => {
    const { deleteGoalAction } = await import('./goals');
    const member = await makeHouseholdWithUser('member', 'Goal delete A');
    const [goal] = await db
      .insert(goals)
      .values({ householdId: member.household.id, name: 'Trip', targetAmount: '1000.00' })
      .returning();

    mockToken = member.token;
    const result = await deleteGoalAction(undefined, formData({ id: goal.id }));
    expect(result).toEqual({ success: true });

    const rows = await db.select().from(goals).where(eq(goals.id, goal.id));
    expect(rows).toHaveLength(0);

    await cleanup(member.household.id);
  });

  it('cannot delete a goal in a DIFFERENT household (cross-tenant probe)', async () => {
    const { deleteGoalAction } = await import('./goals');
    const memberA = await makeHouseholdWithUser('member', 'Goal delete B-A');
    const memberB = await makeHouseholdWithUser('member', 'Goal delete B-B');
    const [goalInB] = await db
      .insert(goals)
      .values({ householdId: memberB.household.id, name: 'B Goal', targetAmount: '1000.00' })
      .returning();

    mockToken = memberA.token;
    const result = await deleteGoalAction(undefined, formData({ id: goalInB.id }));
    expect(result).toEqual({ error: 'Goal not found.' });

    const rows = await db.select().from(goals).where(eq(goals.id, goalInB.id));
    expect(rows).toHaveLength(1);

    await cleanup(memberA.household.id, memberB.household.id);
  });

  it('deletes a goal even when FEATURE_SAVINGS_GOALS is disabled (unlike create/update, deliberately not gated — an owner who turns the feature off still needs to remove old data)', async () => {
    const member = await makeHouseholdWithUser('member', 'Goal delete C');
    const [goal] = await db
      .insert(goals)
      .values({ householdId: member.household.id, name: 'Trip', targetAmount: '1000.00' })
      .returning();

    vi.doMock('../../lib/env', () => ({ env: { FEATURE_SAVINGS_GOALS: false } }));
    vi.resetModules();
    try {
      const { deleteGoalAction } = await import('./goals');

      mockToken = member.token;
      const result = await deleteGoalAction(undefined, formData({ id: goal.id }));
      expect(result).toEqual({ success: true });

      const rows = await db.select().from(goals).where(eq(goals.id, goal.id));
      expect(rows).toHaveLength(0);

      await cleanup(member.household.id);
    } finally {
      vi.doUnmock('../../lib/env');
      vi.resetModules();
    }
  });
});
