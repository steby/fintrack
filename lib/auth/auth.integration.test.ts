import { describe, expect, it } from 'vitest';
import { eq, and, gte } from 'drizzle-orm';
import { db } from '../db';
import { households, users, sessions, householdInvitations, loginAttempts } from '../db/schema';
import { generateToken } from './token';
import { newExpiry, isExpired } from './session-rules';
import { validateInvite, inviteExpiry } from './invite-rules';
import {
  isRateLimited,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
} from './rate-limit';

async function makeHouseholdWithOwner(name: string) {
  const [household] = await db.insert(households).values({ name }).returning();
  const [owner] = await db
    .insert(users)
    .values({
      householdId: household.id,
      email: `${name.replace(/\s+/g, '-')}-${Date.now()}@example.com`,
      passwordHash: 'x',
      name: 'Owner',
      role: 'owner',
    })
    .returning();
  return { household, owner };
}

describe('session lifecycle against real Postgres', () => {
  it('a freshly created session is not expired, and Drizzle returns a real Date (not a string) for expires_at', async () => {
    const { household, owner } = await makeHouseholdWithOwner('Session lifecycle A');
    const token = generateToken();
    await db.insert(sessions).values({ id: token, userId: owner.id, expiresAt: newExpiry() });

    const [row] = await db.select().from(sessions).where(eq(sessions.id, token)).limit(1);

    // This is the exact failure mode that would silently break lib/auth/session.ts's
    // isExpired(row.expiresAt) check: if the driver ever returned a string instead of a
    // Date, `.getTime()` inside isExpired would throw (or worse, coerce unpredictably).
    expect(row.expiresAt).toBeInstanceOf(Date);
    expect(isExpired(row.expiresAt)).toBe(false);

    await db.delete(households).where(eq(households.id, household.id));
  });

  it('a session inserted with an already-past expiry is correctly detected as expired', async () => {
    const { household, owner } = await makeHouseholdWithOwner('Session lifecycle B');
    const token = generateToken();
    await db
      .insert(sessions)
      .values({ id: token, userId: owner.id, expiresAt: new Date(Date.now() - 1000) });

    const [row] = await db.select().from(sessions).where(eq(sessions.id, token)).limit(1);
    expect(isExpired(row.expiresAt)).toBe(true);

    await db.delete(households).where(eq(households.id, household.id));
  });

  it('revoking a session (delete by id) means it can no longer be found', async () => {
    const { household, owner } = await makeHouseholdWithOwner('Session lifecycle C');
    const token = generateToken();
    await db.insert(sessions).values({ id: token, userId: owner.id, expiresAt: newExpiry() });

    await db.delete(sessions).where(eq(sessions.id, token));

    const rows = await db.select().from(sessions).where(eq(sessions.id, token));
    expect(rows).toHaveLength(0);

    await db.delete(households).where(eq(households.id, household.id));
  });
});

describe('login rate limiting against real Postgres', () => {
  it('the exact query pattern loginAction uses correctly identifies a rate-limited email+IP pair', async () => {
    const email = `rate-limit-${Date.now()}@example.com`;
    const ip = '203.0.113.10';

    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_ATTEMPTS; i++) {
      await db.insert(loginAttempts).values({ email, ip, success: false });
    }

    // Same query shape as app/actions/auth.ts's loginAction.
    const recentAttempts = await db
      .select({ attemptedAt: loginAttempts.attemptedAt, success: loginAttempts.success })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.email, email),
          eq(loginAttempts.ip, ip),
          gte(loginAttempts.attemptedAt, new Date(Date.now() - LOGIN_RATE_LIMIT_WINDOW_MS)),
        ),
      );

    expect(isRateLimited(recentAttempts)).toBe(true);

    await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
  });

  it('a different IP for the same email is not rate-limited by the other IP’s failures', async () => {
    const email = `rate-limit-ip-${Date.now()}@example.com`;
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_ATTEMPTS; i++) {
      await db.insert(loginAttempts).values({ email, ip: '203.0.113.11', success: false });
    }

    const recentAttempts = await db
      .select({ attemptedAt: loginAttempts.attemptedAt, success: loginAttempts.success })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.email, email),
          eq(loginAttempts.ip, '203.0.113.99'),
          gte(loginAttempts.attemptedAt, new Date(Date.now() - LOGIN_RATE_LIMIT_WINDOW_MS)),
        ),
      );

    expect(isRateLimited(recentAttempts)).toBe(false);

    await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
  });
});

describe('invite validation against a real fetched row', () => {
  it('validates a freshly created invitation as valid', async () => {
    const { household, owner } = await makeHouseholdWithOwner('Invite validation A');
    const token = generateToken();
    await db.insert(householdInvitations).values({
      householdId: household.id,
      email: 'invitee@example.com',
      role: 'viewer',
      token,
      invitedByUserId: owner.id,
      expiresAt: inviteExpiry(),
    });

    const [row] = await db
      .select()
      .from(householdInvitations)
      .where(eq(householdInvitations.token, token))
      .limit(1);

    expect(row.expiresAt).toBeInstanceOf(Date);
    expect(validateInvite(row, token)).toEqual({ valid: true });

    await db.delete(households).where(eq(households.id, household.id));
  });

  it('validates an accepted invitation (real acceptedAt Date from Postgres) as already_accepted', async () => {
    const { household, owner } = await makeHouseholdWithOwner('Invite validation B');
    const token = generateToken();
    await db.insert(householdInvitations).values({
      householdId: household.id,
      email: 'invitee2@example.com',
      role: 'viewer',
      token,
      invitedByUserId: owner.id,
      expiresAt: inviteExpiry(),
      acceptedAt: new Date(),
    });

    const [row] = await db
      .select()
      .from(householdInvitations)
      .where(eq(householdInvitations.token, token))
      .limit(1);

    expect(row.acceptedAt).toBeInstanceOf(Date);
    expect(validateInvite(row, token)).toEqual({ valid: false, reason: 'already_accepted' });

    await db.delete(households).where(eq(households.id, household.id));
  });
});
