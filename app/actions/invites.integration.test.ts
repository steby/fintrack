import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../lib/db';
import { households, users, sessions, householdInvitations } from '../../lib/db/schema';
import { generateToken } from '../../lib/auth/token';
import { newExpiry } from '../../lib/auth/session-rules';
import { inviteExpiry } from '../../lib/auth/invite-rules';

// Same mocking strategy as app/actions/members.integration.test.ts: mock next/headers
// (cookies) and server-only so these Server Actions run against a REAL database with
// only the Next-runtime-specific plumbing replaced. redirect() is additionally mocked
// here (members.ts's actions never redirect; invites.ts's acceptInviteAction does on
// success) to throw a catchable marker instead of crashing the test process.
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
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

afterAll(async () => {
  await pool.end();
});

afterEach(() => {
  mockToken = undefined;
});

async function makeHouseholdWithUser(role: 'owner' | 'member' | 'viewer', label: string) {
  const [household] = await db.insert(households).values({ name: label }).returning();
  const [user] = await db
    .insert(users)
    .values({
      householdId: household.id,
      email: `${label.replace(/\s+/g, '-')}-${Date.now()}-${Math.random()}@example.com`,
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

function isRedirect(reason: unknown): boolean {
  return reason instanceof Error && reason.message.startsWith('NEXT_REDIRECT');
}

describe('createInviteAction', () => {
  it('an owner can create an invite', async () => {
    const { createInviteAction } = await import('./invites');
    const owner = await makeHouseholdWithUser('owner', 'Invite create A');
    mockToken = owner.token;

    const email = `invitee-${Date.now()}@example.com`;
    const result = await createInviteAction(undefined, formData({ email, role: 'viewer' }));

    expect(result).toEqual({ success: true });
    const rows = await db
      .select()
      .from(householdInvitations)
      .where(eq(householdInvitations.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0].householdId).toBe(owner.household.id);

    await cleanup(owner.household.id);
  });

  it('a member cannot create an invite (requireRole rejects before any DB write)', async () => {
    const { createInviteAction } = await import('./invites');
    const member = await makeHouseholdWithUser('member', 'Invite create B');
    mockToken = member.token;

    const email = `invitee-${Date.now()}@example.com`;
    await expect(
      createInviteAction(undefined, formData({ email, role: 'viewer' })),
    ).rejects.toThrow('You do not have permission to perform this action.');

    const rows = await db
      .select()
      .from(householdInvitations)
      .where(eq(householdInvitations.email, email));
    expect(rows).toHaveLength(0);

    await cleanup(member.household.id);
  });

  it('rejects inviting an email that already belongs to a user', async () => {
    const { createInviteAction } = await import('./invites');
    const owner = await makeHouseholdWithUser('owner', 'Invite create C');
    const existing = await makeHouseholdWithUser('viewer', 'Invite create C target');

    mockToken = owner.token;
    const result = await createInviteAction(
      undefined,
      formData({ email: existing.user.email, role: 'viewer' }),
    );

    expect(result).toEqual({ error: 'That email is already a member of a household.' });

    await cleanup(owner.household.id, existing.household.id);
  });

  it('is idempotent: a resubmit for the same email does not create a second pending invite', async () => {
    const { createInviteAction } = await import('./invites');
    const owner = await makeHouseholdWithUser('owner', 'Invite create D');
    mockToken = owner.token;
    const email = `invitee-${Date.now()}@example.com`;

    const first = await createInviteAction(undefined, formData({ email, role: 'viewer' }));
    const second = await createInviteAction(undefined, formData({ email, role: 'member' }));

    expect(first).toEqual({ success: true });
    expect(second).toEqual({ error: 'An invite is already pending for that email.' });

    const rows = await db
      .select()
      .from(householdInvitations)
      .where(eq(householdInvitations.email, email));
    expect(rows).toHaveLength(1);

    await cleanup(owner.household.id);
  });

  it('allows a fresh invite once the previous one to the same email has expired, reissuing the same row', async () => {
    const { createInviteAction } = await import('./invites');
    const owner = await makeHouseholdWithUser('owner', 'Invite create E');
    const email = `invitee-${Date.now()}@example.com`;
    const staleToken = generateToken();

    await db.insert(householdInvitations).values({
      householdId: owner.household.id,
      email,
      role: 'viewer',
      token: staleToken,
      invitedByUserId: owner.user.id,
      expiresAt: new Date(Date.now() - 1000),
    });

    mockToken = owner.token;
    const result = await createInviteAction(undefined, formData({ email, role: 'member' }));

    expect(result).toEqual({ success: true });
    // The atomic upsert (household_invitations_household_email_pending_unique) reissues
    // the existing unaccepted row in place rather than inserting a second one — only one
    // row per (household, email) can ever be pending at once, by construction.
    const rows = await db
      .select()
      .from(householdInvitations)
      .where(eq(householdInvitations.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('member');
    expect(rows[0].token).not.toBe(staleToken);
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

    await cleanup(owner.household.id);
  });

  it('concurrent invite creations for the same email only leave ONE pending invite (TOCTOU race fix)', async () => {
    const { createInviteAction } = await import('./invites');
    const owner = await makeHouseholdWithUser('owner', 'Invite create race');
    mockToken = owner.token;
    const email = `invitee-race-${Date.now()}@example.com`;

    const submit = () => createInviteAction(undefined, formData({ email, role: 'viewer' }));
    const results = await Promise.all([submit(), submit()]);

    // Exactly one request wins (a fresh insert); the other loses the atomic
    // ON CONFLICT ... WHERE race and gets the friendly "already pending" error — not a
    // second live row and not an uncaught unique-constraint exception.
    expect(results.filter((r) => r?.success)).toHaveLength(1);
    expect(results).toContainEqual({ error: 'An invite is already pending for that email.' });

    const rows = await db
      .select()
      .from(householdInvitations)
      .where(eq(householdInvitations.email, email));
    expect(rows).toHaveLength(1);

    await cleanup(owner.household.id);
  });
});

describe('acceptInviteAction', () => {
  it('accepts a valid invite, creates the user, and redirects', async () => {
    const { acceptInviteAction } = await import('./invites');
    const owner = await makeHouseholdWithUser('owner', 'Invite accept A');
    const token = generateToken();
    const email = `invitee-${Date.now()}@example.com`;
    await db.insert(householdInvitations).values({
      householdId: owner.household.id,
      email,
      role: 'member',
      token,
      invitedByUserId: owner.user.id,
      expiresAt: inviteExpiry(),
    });

    await expect(
      acceptInviteAction(
        undefined,
        formData({ token, name: 'New Member', password: 'a-fresh-password-123' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT:/');

    const createdUsers = await db.select().from(users).where(eq(users.email, email));
    expect(createdUsers).toHaveLength(1);
    expect(createdUsers[0].role).toBe('member');

    const [invitationRow] = await db
      .select()
      .from(householdInvitations)
      .where(eq(householdInvitations.token, token));
    expect(invitationRow.acceptedAt).not.toBeNull();

    await cleanup(owner.household.id);
  });

  it('rejects an expired invite', async () => {
    const { acceptInviteAction } = await import('./invites');
    const owner = await makeHouseholdWithUser('owner', 'Invite accept B');
    const token = generateToken();
    await db.insert(householdInvitations).values({
      householdId: owner.household.id,
      email: 'expired@example.com',
      role: 'viewer',
      token,
      invitedByUserId: owner.user.id,
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await acceptInviteAction(
      undefined,
      formData({ token, name: 'X', password: 'a-fresh-password-123' }),
    );
    expect(result).toEqual({
      error: 'This invite link has expired. Ask the household owner to send a new one.',
    });

    await cleanup(owner.household.id);
  });

  it('rejects a replayed (already-accepted) invite', async () => {
    const { acceptInviteAction } = await import('./invites');
    const owner = await makeHouseholdWithUser('owner', 'Invite accept C');
    const token = generateToken();
    await db.insert(householdInvitations).values({
      householdId: owner.household.id,
      email: 'used@example.com',
      role: 'viewer',
      token,
      invitedByUserId: owner.user.id,
      expiresAt: inviteExpiry(),
      acceptedAt: new Date(),
    });

    const result = await acceptInviteAction(
      undefined,
      formData({ token, name: 'X', password: 'a-fresh-password-123' }),
    );
    expect(result).toEqual({ error: 'This invite has already been used.' });

    await cleanup(owner.household.id);
  });

  it('concurrent submissions of the same invite link only create ONE user (TOCTOU race fix)', async () => {
    const { acceptInviteAction } = await import('./invites');
    const owner = await makeHouseholdWithUser('owner', 'Invite accept race');
    const token = generateToken();
    const email = `race-${Date.now()}@example.com`;
    await db.insert(householdInvitations).values({
      householdId: owner.household.id,
      email,
      role: 'viewer',
      token,
      invitedByUserId: owner.user.id,
      expiresAt: inviteExpiry(),
    });

    const submit = () =>
      acceptInviteAction(
        undefined,
        formData({ token, name: 'Racer', password: 'a-fresh-password-123' }),
      );

    const results = await Promise.allSettled([submit(), submit()]);
    const outcomes = results.map((r) =>
      r.status === 'fulfilled' ? r.value : isRedirect(r.reason) ? 'redirected' : r.reason,
    );

    // Exactly one request wins (redirects); the other gets the friendly "already used"
    // error, not an uncaught unique-constraint exception.
    expect(outcomes.filter((o) => o === 'redirected')).toHaveLength(1);
    expect(outcomes).toContainEqual({ error: 'This invite has already been used.' });

    const createdUsers = await db.select().from(users).where(eq(users.email, email));
    expect(createdUsers).toHaveLength(1);

    await cleanup(owner.household.id);
  });

  it('revokes an existing session before creating the new one for an already-logged-in submitter', async () => {
    const { acceptInviteAction } = await import('./invites');
    const owner = await makeHouseholdWithUser('owner', 'Invite accept D');
    const alreadyLoggedIn = await makeHouseholdWithUser('viewer', 'Invite accept D other');
    const token = generateToken();
    const email = `invitee-${Date.now()}@example.com`;
    await db.insert(householdInvitations).values({
      householdId: owner.household.id,
      email,
      role: 'member',
      token,
      invitedByUserId: owner.user.id,
      expiresAt: inviteExpiry(),
    });

    // Simulate: the browser submitting the invite already has a valid session cookie.
    mockToken = alreadyLoggedIn.token;

    await expect(
      acceptInviteAction(
        undefined,
        formData({ token, name: 'New Member', password: 'a-fresh-password-123' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT:/');

    const oldSessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, alreadyLoggedIn.token));
    expect(oldSessionRows).toHaveLength(0);

    await cleanup(owner.household.id, alreadyLoggedIn.household.id);
  });
});
