import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../lib/db';
import { households, users, sessions } from '../../lib/db/schema';
import { generateToken } from '../../lib/auth/token';
import { newExpiry } from '../../lib/auth/session-rules';

// Server Actions call next/headers's cookies() (which throws outside a real Next.js
// request context) and lib/auth/session.ts/guards.ts import the `server-only` guard
// package (which, by design, always throws when imported outside Next's own bundler —
// that's its literal implementation, the mechanism it uses to catch an accidental
// client-component import at build time). Mocking cookies() to read from a plain,
// per-test-settable variable, and no-op-ing server-only, lets these actions run against
// a REAL database with only the Next-runtime-specific plumbing replaced — the same
// pattern Phase 0's lib/observability.test.ts already uses for Next-adjacent modules.
let mockToken: string | undefined;
vi.mock('server-only', () => ({}));
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

async function makeHouseholdWithUser(role: 'owner' | 'member' | 'viewer') {
  const [household] = await db
    .insert(households)
    .values({ name: `Test ${role} household` })
    .returning();
  const [user] = await db
    .insert(users)
    .values({
      householdId: household.id,
      email: `${role}-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: 'x',
      name: role,
      role,
    })
    .returning();
  const token = generateToken();
  await db.insert(sessions).values({ id: token, userId: user.id, expiresAt: newExpiry() });
  return { household, user, token };
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

async function cleanup(...householdIds: string[]) {
  for (const id of householdIds) {
    await db.delete(households).where(eq(households.id, id));
  }
}

describe('changeMemberRoleAction / removeMemberAction — role and cross-household enforcement', () => {
  it('an owner can change another member’s role within their own household', async () => {
    const { changeMemberRoleAction } = await import('./members');
    const owner = await makeHouseholdWithUser('owner');
    const { user: target } = await makeHouseholdWithUser('viewer');
    // Re-home the target into the owner's household for this test.
    await db.update(users).set({ householdId: owner.household.id }).where(eq(users.id, target.id));

    mockToken = owner.token;
    const result = await changeMemberRoleAction(
      undefined,
      formData({ userId: target.id, role: 'member' }),
    );

    expect(result).toEqual({ success: true });
    const [updated] = await db.select().from(users).where(eq(users.id, target.id));
    expect(updated.role).toBe('member');

    await cleanup(owner.household.id);
  });

  it('a member cannot change anyone’s role — requireRole rejects before the DB write', async () => {
    const { changeMemberRoleAction } = await import('./members');
    const member = await makeHouseholdWithUser('member');
    const { user: target } = await makeHouseholdWithUser('viewer');
    await db.update(users).set({ householdId: member.household.id }).where(eq(users.id, target.id));

    mockToken = member.token;
    await expect(
      changeMemberRoleAction(undefined, formData({ userId: target.id, role: 'owner' })),
    ).rejects.toThrow('You do not have permission to perform this action.');

    const [unchanged] = await db.select().from(users).where(eq(users.id, target.id));
    expect(unchanged.role).toBe('viewer');

    await cleanup(member.household.id);
  });

  it('a viewer cannot change anyone’s role either', async () => {
    const { changeMemberRoleAction } = await import('./members');
    const viewer = await makeHouseholdWithUser('viewer');
    const { user: target } = await makeHouseholdWithUser('viewer');

    mockToken = viewer.token;
    await expect(
      changeMemberRoleAction(undefined, formData({ userId: target.id, role: 'owner' })),
    ).rejects.toThrow('You do not have permission to perform this action.');

    await cleanup(viewer.household.id, target.householdId);
  });

  it('an owner cannot change the role of a user in a DIFFERENT household (cross-tenant probe)', async () => {
    const { changeMemberRoleAction } = await import('./members');
    const ownerA = await makeHouseholdWithUser('owner');
    const { user: userInB, household: householdB } = await makeHouseholdWithUser('viewer');

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
    const ownerA = await makeHouseholdWithUser('owner');
    const { user: userInB, household: householdB } = await makeHouseholdWithUser('viewer');

    mockToken = ownerA.token;
    const result = await removeMemberAction(undefined, formData({ userId: userInB.id }));

    expect(result).toEqual({ error: 'Member not found.' });
    const [stillThere] = await db.select().from(users).where(eq(users.id, userInB.id));
    expect(stillThere).toBeDefined();

    await cleanup(ownerA.household.id, householdB.id);
  });

  it('an owner cannot remove themselves via the action', async () => {
    const { removeMemberAction } = await import('./members');
    const owner = await makeHouseholdWithUser('owner');

    mockToken = owner.token;
    const result = await removeMemberAction(undefined, formData({ userId: owner.user.id }));

    expect(result).toEqual({ error: 'You cannot remove yourself.' });

    await cleanup(owner.household.id);
  });
});
