import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../lib/db';
import { users } from '../../lib/db/schema';
import { makeHouseholdWithUser, formData, cleanup } from './test-helpers';

// Server Actions call next/headers's cookies() (which throws outside a real Next.js
// request context). Mocking it to read from a plain, per-test-settable variable lets
// these actions run against a REAL database with only the Next-runtime-specific
// plumbing replaced. (server-only/next/cache are also mocked — for every
// *.integration.test.ts file, not just this one — in vitest.setup.integration.ts.)
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

describe('changeMemberRoleAction / removeMemberAction — role and cross-household enforcement', () => {
  it('an owner can change another member’s role within their own household', async () => {
    const { changeMemberRoleAction } = await import('./members');
    const owner = await makeHouseholdWithUser('owner', 'Members role change A-owner');
    const { user: target, household: targetHousehold } = await makeHouseholdWithUser(
      'viewer',
      'Members role change A-target',
    );
    // Re-home the target into the owner's household for this test. targetHousehold is
    // now empty (no user references it) but the row itself still exists and must be
    // cleaned up separately from owner.household.id.
    await db.update(users).set({ householdId: owner.household.id }).where(eq(users.id, target.id));

    mockToken = owner.token;
    const result = await changeMemberRoleAction(
      undefined,
      formData({ userId: target.id, role: 'member' }),
    );

    expect(result).toEqual({ success: true });
    const [updated] = await db.select().from(users).where(eq(users.id, target.id));
    expect(updated.role).toBe('member');

    await cleanup(owner.household.id, targetHousehold.id);
  });

  it('a member cannot change anyone’s role — requireRole rejects before the DB write', async () => {
    const { changeMemberRoleAction } = await import('./members');
    const member = await makeHouseholdWithUser('member', 'Members role change B-member');
    const { user: target, household: targetHousehold } = await makeHouseholdWithUser(
      'viewer',
      'Members role change B-target',
    );
    await db.update(users).set({ householdId: member.household.id }).where(eq(users.id, target.id));

    mockToken = member.token;
    await expect(
      changeMemberRoleAction(undefined, formData({ userId: target.id, role: 'owner' })),
    ).rejects.toThrow('You do not have permission to perform this action.');

    const [unchanged] = await db.select().from(users).where(eq(users.id, target.id));
    expect(unchanged.role).toBe('viewer');

    await cleanup(member.household.id, targetHousehold.id);
  });

  it('a viewer cannot change anyone’s role either', async () => {
    const { changeMemberRoleAction } = await import('./members');
    const viewer = await makeHouseholdWithUser('viewer', 'Members role change C-viewer');
    const { user: target } = await makeHouseholdWithUser('viewer', 'Members role change C-target');

    mockToken = viewer.token;
    await expect(
      changeMemberRoleAction(undefined, formData({ userId: target.id, role: 'owner' })),
    ).rejects.toThrow('You do not have permission to perform this action.');

    await cleanup(viewer.household.id, target.householdId);
  });

  it('an owner cannot change the role of a user in a DIFFERENT household (cross-tenant probe)', async () => {
    const { changeMemberRoleAction } = await import('./members');
    const ownerA = await makeHouseholdWithUser('owner', 'Members cross-tenant role A');
    const { user: userInB, household: householdB } = await makeHouseholdWithUser(
      'viewer',
      'Members cross-tenant role B',
    );

    mockToken = ownerA.token;
    const result = await changeMemberRoleAction(
      undefined,
      formData({ userId: userInB.id, role: 'owner' }),
    );

    // Generic "not found" — never reveals that the id belongs to a different household.
    expect(result).toEqual({ error: 'Member not found.' });
    const [unchanged] = await db.select().from(users).where(eq(users.id, userInB.id));
    expect(unchanged.role).toBe('viewer');

    await cleanup(ownerA.household.id, householdB.id);
  });

  it('an owner cannot remove a member from a DIFFERENT household (cross-tenant probe)', async () => {
    const { removeMemberAction } = await import('./members');
    const ownerA = await makeHouseholdWithUser('owner', 'Members cross-tenant remove A');
    const { user: userInB, household: householdB } = await makeHouseholdWithUser(
      'viewer',
      'Members cross-tenant remove B',
    );

    mockToken = ownerA.token;
    const result = await removeMemberAction(undefined, formData({ userId: userInB.id }));

    expect(result).toEqual({ error: 'Member not found.' });
    const [stillThere] = await db.select().from(users).where(eq(users.id, userInB.id));
    expect(stillThere).toBeDefined();

    await cleanup(ownerA.household.id, householdB.id);
  });

  it('an owner cannot remove themselves via the action', async () => {
    const { removeMemberAction } = await import('./members');
    const owner = await makeHouseholdWithUser('owner', 'Members remove self');

    mockToken = owner.token;
    const result = await removeMemberAction(undefined, formData({ userId: owner.user.id }));

    expect(result).toEqual({ error: 'You cannot remove yourself.' });

    await cleanup(owner.household.id);
  });
});
