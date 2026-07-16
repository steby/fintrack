'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { users, sessions, passwordResetTokens } from '../../lib/db/schema';
import { hashPassword, validatePassword } from '../../lib/auth/password';
import { generateToken, hashToken } from '../../lib/auth/token';
import {
  newResetExpiry,
  validateResetToken,
  MAX_ACTIVE_RESET_TOKENS,
  RESET_TOKEN_TTL_MS,
} from '../../lib/auth/password-reset-rules';
import { createSession } from '../../lib/auth/session';
import { normalizeEmail, emailEquals } from '../../lib/auth/email';
import { sendPasswordResetEmail } from '../../lib/email/password-reset';
import { env } from '../../lib/env';
import { logger } from '../../lib/log';

export type PasswordResetState = { error?: string; success?: boolean } | undefined;

const requestSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').max(320),
});

// The response is CONSTANT whether or not the email has an account (no enumeration
// oracle), and all real work happens after that decision — a failure to send is logged,
// never surfaced. Issuance is capped per user per TTL window (password-reset-rules.ts)
// so a scripted requester can't flood a mailbox or grow the token table unboundedly.
export async function requestPasswordResetAction(
  _prevState: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const parsed = requestSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter a valid email.' };
  }
  const email = normalizeEmail(parsed.data.email);

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(emailEquals(users.email, email))
    .limit(1);

  if (user) {
    const windowStart = new Date(Date.now() - RESET_TOKEN_TTL_MS);
    const [{ recent }] = await db
      .select({ recent: sql<number>`count(*)::int` })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          gte(passwordResetTokens.createdAt, windowStart),
        ),
      );

    if (recent < MAX_ACTIVE_RESET_TOKENS) {
      const token = generateToken();
      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: newResetExpiry(),
      });
      await sendPasswordResetEmail(user.email, `${env.APP_URL}/reset/${token}`);
    } else {
      logger.warn({ userId: user.id }, 'Password reset issuance cap hit; not sending another');
    }
  }

  return { success: true };
}

const resetSchema = z.object({
  token: z.string().min(1).max(200),
  // .max(200) is the same defense-in-depth cap loginSchema documents (app/actions/
  // auth.ts) — argon2 is memory-hard by design, so hashing an attacker-sized
  // (megabytes) password would be a cheap CPU/memory-exhaustion lever on this pre-auth
  // endpoint. Real quality rules live in validatePassword below.
  password: z.string().max(200),
});

// Consumes a reset link: single-use, short-lived, looked up by hashToken(token) (the
// DB never holds the raw token — same at-rest rule as sessions). On success every
// existing session is revoked (a reset IS the stolen-credential remedy; unlike
// change-password there's no "current session" to spare) and a fresh one is created,
// same auto-login shape as accepting an invite.
export async function resetPasswordAction(
  _prevState: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const parsed = resetSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  const validation = validatePassword(parsed.data.password);
  if (!validation.valid) {
    return { error: validation.message };
  }

  const [row] = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      expiresAt: passwordResetTokens.expiresAt,
      usedAt: passwordResetTokens.usedAt,
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hashToken(parsed.data.token)))
    .limit(1);

  // One generic message for missing/expired/used — the distinction is logged for the
  // operator, not revealed to whoever is holding the link.
  const invalidMessage = 'This reset link is invalid or has expired. Request a new one.';
  if (!row) {
    return { error: invalidMessage };
  }
  const validity = validateResetToken(row);
  if (!validity.valid) {
    logger.info({ tokenId: row.id, reason: validity.reason }, 'Rejected password reset token');
    return { error: invalidMessage };
  }

  const newHash = await hashPassword(parsed.data.password);
  const ALREADY_CONSUMED = 'reset token already consumed';
  try {
    await db.transaction(async (tx) => {
      // usedAt guard INSIDE the transaction's WHERE — two racing submits of the same
      // link can't both pass the read above, but only one can win this conditional
      // update; the loser's rowCount 0 aborts before the password/session writes.
      const claimed = await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
        .returning({ id: passwordResetTokens.id });
      if (!claimed[0]) {
        throw new Error(ALREADY_CONSUMED);
      }
      await tx.update(users).set({ passwordHash: newHash }).where(eq(users.id, row.userId));
      await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    });
  } catch (err) {
    // Only the race-loser sentinel maps to the friendly message — a genuine DB failure
    // must stay loud, not masquerade as a stale link.
    if (err instanceof Error && err.message === ALREADY_CONSUMED) {
      return { error: invalidMessage };
    }
    throw err;
  }

  await createSession(row.userId);
  redirect('/');
}
