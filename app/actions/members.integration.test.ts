import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { db } from '../../lib/db';
import { users } from '../../lib/db/schema';
import { makeHouseholdWithUser, formData, cleanup } from './test-helpers';
import type { MemberActionState } from './members';

// Server Actions call next/headers's cookies() (which throws outside a real Next.js
// request context). Mocking it to read from a plain, per-test-settable variable lets
// these actions run against a REAL database with only the Next-runtime-specific
// plumbing replaced. (server-only/next/cache are also mocked — for every
// *.integration.test.ts file, not just this one — in vitest.setup.integration.ts.)
// `cookies` itself is a vi.fn() (not a plain arrow function) so the concurrency tests
// below can queue per-call mockImplementationOnce overrides — each Server Action call's
// synchronous prefix calls cookies() exactly once (requireRole -> requireUser ->
// getSessionUser -> `await cookies()`) before its first real suspension, so invoking two
// actions back-to-back without awaiting between them consumes the queued overrides in
// the same order the actions were called, deterministically giving each call a fixed,
// distinct identity instead of racing on the shared `mockToken` variable (which would
// NOT be safe for concurrent calls: `cookieStore.get('session')` reads `mockToken` only
// after `await cookies()` resolves, i.e. on a later microtask — by then a second
// sequential, non-awaited call would already have overwritten it for both).
let mockToken: string | undefined;
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'session' && mockToken ? { name, value: mockToken } : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

afterEach(() => {
  mockToken = undefined;
});

// Minimal fake matching only what getSessionUser actually calls (.get) — cast rather
// than fully implementing ReadonlyRequestCookies (has/getAll/size/[Symbol.iterator]),
// same tradeoff the file's default mock above already makes, just needing an explicit
// cast here since vi.mocked(cookies) type-checks against the real cookies() signature.
function fakeCookies(token: string): Awaited<ReturnType<typeof cookies>> {
  return {
    get: (name: string) => (name === 'session' ? { name, value: token } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  } as unknown as Awaited<ReturnType<typeof cookies>>;
}

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

  it('demoting one of two owners is allowed — the household still has an owner left', async () => {
    const { changeMemberRoleAction } = await import('./members');
    const ownerA = await makeHouseholdWithUser('owner', 'Members two-owner demote A');
    const { user: ownerBUser, household: ownerBHousehold } = await makeHouseholdWithUser(
      'owner',
      'Members two-owner demote B',
    );
    await db
      .update(users)
      .set({ householdId: ownerA.household.id })
      .where(eq(users.id, ownerBUser.id));

    mockToken = ownerA.token;
    const result = await changeMemberRoleAction(
      undefined,
      formData({ userId: ownerBUser.id, role: 'member' }),
    );

    expect(result).toEqual({ success: true });

    // ownerBHousehold is now empty (its only user was re-homed above) but the row
    // itself still exists and must be cleaned up separately from ownerA's household —
    // the same pattern the cross-household tests above already follow.
    await cleanup(ownerA.household.id, ownerBHousehold.id);
  });
});

describe('changeMemberRoleAction / removeMemberAction — last-owner protection under concurrency', () => {
  // The last-owner guard is unreachable via a single sequential call (the acting user
  // must themselves be an owner via requireRole, and can never target themselves — see
  // the "cannot change/remove yourself" tests above), so it only matters as a defense
  // against two owners concurrently demoting/removing EACH OTHER. These tests fire both
  // actions via Promise.all against a real 2-owner household on the real DB, to prove
  // the SELECT ... FOR UPDATE lock (see members.ts) actually serializes the two
  // transactions and the second one correctly re-reads the first's committed result,
  // rather than trusting that reasoning about Postgres's locking semantics in the abstract.

  // Both calls' OWN requireRole check runs against a fresh session read, at whatever
  // moment each call happens to reach it — there's no barrier guaranteeing both pass
  // that check before either transaction commits. Two valid race orderings exist:
  //  (a) both calls pass their own requireRole check before either commits, in which
  //      case the FOR UPDATE lock + re-check inside the transaction rejects the second
  //      one with the explicit "last owner" error, or
  //  (b) the first call fully completes (demoting the second call's OWN acting user)
  //      before the second call even re-reads its own session, in which case the second
  //      call's requireRole throws ForbiddenError instead — its permission was
  //      legitimately revoked by the first call's effect, a correct outcome, just a
  //      different valid rejection shape than (a).
  // Either way the invariant that actually matters holds: exactly one call succeeds,
  // the other is rejected one way or another, and the household never ends up with
  // zero owners. Promise.allSettled (not Promise.all) so a thrown ForbiddenError from
  // ordering (b) doesn't fail the whole assertion — both orderings are acceptable.
  async function classifyRaceOutcome(
    settled: PromiseSettledResult<MemberActionState>,
  ): Promise<'success' | 'rejected'> {
    if (settled.status === 'rejected') {
      expect(settled.reason).toMatchObject({ name: 'ForbiddenError' });
      return 'rejected';
    }
    if (settled.value?.success) return 'success';
    expect(settled.value?.error).toMatch(/last owner/i);
    return 'rejected';
  }

  it('concurrently demoting both owners of a 2-owner household leaves exactly one owner, never zero', async () => {
    const { changeMemberRoleAction } = await import('./members');
    const ownerA = await makeHouseholdWithUser('owner', 'Members race demote A');
    const {
      user: ownerBUser,
      token: tokenB,
      household: ownerBHousehold,
    } = await makeHouseholdWithUser('owner', 'Members race demote B');
    await db
      .update(users)
      .set({ householdId: ownerA.household.id })
      .where(eq(users.id, ownerBUser.id));
    const tokenA = ownerA.token;

    vi.mocked(cookies)
      .mockImplementationOnce(() => Promise.resolve(fakeCookies(tokenA)))
      .mockImplementationOnce(() => Promise.resolve(fakeCookies(tokenB)));

    // A demotes B, and (concurrently) B demotes A.
    const settled = await Promise.allSettled([
      changeMemberRoleAction(undefined, formData({ userId: ownerBUser.id, role: 'member' })),
      changeMemberRoleAction(undefined, formData({ userId: ownerA.user.id, role: 'member' })),
    ]);

    const outcomes = await Promise.all(settled.map(classifyRaceOutcome));
    expect(outcomes.filter((o) => o === 'success')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'rejected')).toHaveLength(1);

    const remainingOwners = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.householdId, ownerA.household.id), eq(users.role, 'owner')));
    expect(remainingOwners).toHaveLength(1);

    // ownerBHousehold is now empty (its only user was re-homed above) but the row
    // itself still exists and must be cleaned up separately from ownerA's household.
    await cleanup(ownerA.household.id, ownerBHousehold.id);
  });

  it('concurrently removing both owners of a 2-owner household leaves exactly one owner, never zero', async () => {
    const { removeMemberAction } = await import('./members');
    const ownerA = await makeHouseholdWithUser('owner', 'Members race remove A');
    const {
      user: ownerBUser,
      token: tokenB,
      household: ownerBHousehold,
    } = await makeHouseholdWithUser('owner', 'Members race remove B');
    await db
      .update(users)
      .set({ householdId: ownerA.household.id })
      .where(eq(users.id, ownerBUser.id));
    const tokenA = ownerA.token;

    vi.mocked(cookies)
      .mockImplementationOnce(() => Promise.resolve(fakeCookies(tokenA)))
      .mockImplementationOnce(() => Promise.resolve(fakeCookies(tokenB)));

    const settled = await Promise.allSettled([
      removeMemberAction(undefined, formData({ userId: ownerBUser.id })),
      removeMemberAction(undefined, formData({ userId: ownerA.user.id })),
    ]);

    const outcomes = await Promise.all(settled.map(classifyRaceOutcome));
    expect(outcomes.filter((o) => o === 'success')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'rejected')).toHaveLength(1);

    // Unlike the demote case, a "rejected" removal that hit ForbiddenError (ordering
    // (b) above) means the target user was never actually deleted — only the winning
    // removal's target is gone, so exactly one of the two original users survives as
    // household owner (the same invariant as the demote test, just via DELETE instead
    // of UPDATE).
    const remainingOwners = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.householdId, ownerA.household.id), eq(users.role, 'owner')));
    expect(remainingOwners).toHaveLength(1);

    // ownerBHousehold is now empty (its only user was re-homed above, and either
    // survived or was deleted by the race itself) but the row itself still exists and
    // must be cleaned up separately from ownerA's household.
    await cleanup(ownerA.household.id, ownerBHousehold.id);
  });
});
