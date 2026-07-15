import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { users, sessions, passwordResetTokens } from '../../lib/db/schema';
import { generateToken, hashToken } from '../../lib/auth/token';
import { verifyPassword, hashPassword } from '../../lib/auth/password';
import { newResetExpiry, MAX_ACTIVE_RESET_TOKENS } from '../../lib/auth/password-reset-rules';
import { newExpiry } from '../../lib/auth/session-rules';
import { makeHouseholdWithUser, formData, cleanup } from './test-helpers';

// Same mocking strategy as the other action integration tests; redirect additionally
// mocked because resetPasswordAction auto-logs-in and redirects like acceptInvite.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('requestPasswordResetAction', () => {
  it('returns the SAME constant success for an existing and a nonexistent email (no enumeration oracle)', async () => {
    const { requestPasswordResetAction } = await import('./password-reset');
    const member = await makeHouseholdWithUser('member', 'Reset request A');

    const known = await requestPasswordResetAction(
      undefined,
      formData({ email: member.user.email }),
    );
    const unknown = await requestPasswordResetAction(
      undefined,
      formData({ email: `nobody-${Date.now()}@example.com` }),
    );
    expect(known).toEqual({ success: true });
    expect(unknown).toEqual(known);

    // ...but only the real account got a token row, stored as a HASH (64 hex chars,
    // never the raw 43-char base64url token itself).
    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, member.user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].usedAt).toBeNull();

    await cleanup(member.household.id);
  });

  it('caps issuance per user per window (adversarial mailbox flood)', async () => {
    const { requestPasswordResetAction } = await import('./password-reset');
    const member = await makeHouseholdWithUser('member', 'Reset request B');

    for (let i = 0; i < MAX_ACTIVE_RESET_TOKENS + 2; i++) {
      const result = await requestPasswordResetAction(
        undefined,
        formData({ email: member.user.email }),
      );
      // The response stays constant even once the cap bites — a flooder learns nothing.
      expect(result).toEqual({ success: true });
    }

    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, member.user.id));
    expect(rows).toHaveLength(MAX_ACTIVE_RESET_TOKENS);

    await cleanup(member.household.id);
  });
});

describe('resetPasswordAction', () => {
  async function makeUserWithToken(label: string) {
    const member = await makeHouseholdWithUser('member', label);
    // Give the user a real password hash so the "old password stops working" check is
    // meaningful (test-helpers seeds passwordHash: 'x', not a real argon2 hash).
    await db
      .update(users)
      .set({ passwordHash: await hashPassword('old-password-123') })
      .where(eq(users.id, member.user.id));
    const rawToken = generateToken();
    await db.insert(passwordResetTokens).values({
      userId: member.user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: newResetExpiry(),
    });
    return { member, rawToken };
  }

  it('sets the new password, revokes every session, marks the token used, and auto-logs-in', async () => {
    const { resetPasswordAction } = await import('./password-reset');
    const { member, rawToken } = await makeUserWithToken('Reset consume A');
    // A live session that must NOT survive the reset (stolen-cookie remedy).
    await db.insert(sessions).values({
      id: hashToken(generateToken()),
      userId: member.user.id,
      expiresAt: newExpiry(),
    });

    await expect(
      resetPasswordAction(
        undefined,
        formData({ token: rawToken, password: 'brand-new-password-1' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT:/');

    const [reloadedUser] = await db.select().from(users).where(eq(users.id, member.user.id));
    expect(await verifyPassword(reloadedUser.passwordHash, 'brand-new-password-1')).toBe(true);
    expect(await verifyPassword(reloadedUser.passwordHash, 'old-password-123')).toBe(false);

    const [tokenRow] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, member.user.id));
    expect(tokenRow.usedAt).not.toBeNull();

    // Exactly ONE session remains: the fresh auto-login one created AFTER the revoke
    // (the pre-existing session from makeHouseholdWithUser and the extra one above are
    // both gone).
    const remaining = await db.select().from(sessions).where(eq(sessions.userId, member.user.id));
    expect(remaining).toHaveLength(1);

    await cleanup(member.household.id);
  });

  it('rejects a reused token with the generic message and leaves the password unchanged', async () => {
    const { resetPasswordAction } = await import('./password-reset');
    const { member, rawToken } = await makeUserWithToken('Reset consume B');

    await expect(
      resetPasswordAction(undefined, formData({ token: rawToken, password: 'first-use-pass-1' })),
    ).rejects.toThrow('NEXT_REDIRECT:/');

    const replay = await resetPasswordAction(
      undefined,
      formData({ token: rawToken, password: 'second-use-pass-1' }),
    );
    expect(replay).toEqual({
      error: 'This reset link is invalid or has expired. Request a new one.',
    });
    const [user] = await db.select().from(users).where(eq(users.id, member.user.id));
    expect(await verifyPassword(user.passwordHash, 'first-use-pass-1')).toBe(true);

    await cleanup(member.household.id);
  });

  it('rejects an expired token and a garbage token identically', async () => {
    const { resetPasswordAction } = await import('./password-reset');
    const member = await makeHouseholdWithUser('member', 'Reset consume C');
    const rawToken = generateToken();
    await db.insert(passwordResetTokens).values({
      userId: member.user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() - 1000),
    });

    const expired = await resetPasswordAction(
      undefined,
      formData({ token: rawToken, password: 'valid-password-123' }),
    );
    const garbage = await resetPasswordAction(
      undefined,
      formData({ token: 'not-a-real-token', password: 'valid-password-123' }),
    );
    expect(expired).toEqual({
      error: 'This reset link is invalid or has expired. Request a new one.',
    });
    expect(garbage).toEqual(expired);

    await cleanup(member.household.id);
  });

  it('rejects a too-short password before touching the token (policy holds on this path too)', async () => {
    const { resetPasswordAction } = await import('./password-reset');
    const { member, rawToken } = await makeUserWithToken('Reset consume D');

    const result = await resetPasswordAction(
      undefined,
      formData({ token: rawToken, password: 'short' }),
    );
    expect(result?.error).toMatch(/at least 8/i);

    // Token stays unconsumed — a failed policy check must not burn the link.
    const [tokenRow] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, member.user.id));
    expect(tokenRow.usedAt).toBeNull();

    await cleanup(member.household.id);
  });
});
