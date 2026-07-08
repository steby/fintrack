'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { headers, cookies } from 'next/headers';
import { eq, and, ne, gte } from 'drizzle-orm';
import { db } from '../../lib/db';
import { users, loginAttempts, sessions } from '../../lib/db/schema';
import {
  verifyPassword,
  hashPassword,
  validatePassword,
  DUMMY_PASSWORD_HASH,
} from '../../lib/auth/password';
import { createSession, deleteSession, SESSION_COOKIE_NAME } from '../../lib/auth/session';
import { isRateLimited, LOGIN_RATE_LIMIT_WINDOW_MS } from '../../lib/auth/rate-limit';
import { requireUser } from '../../lib/auth/guards';

const loginSchema = z.object({
  email: z.string().email(),
  // .max(200) is defense-in-depth, not a real password-length policy — this action is
  // reachable pre-authentication, and next.config.ts's Server Actions bodySizeLimit
  // was raised to 20MB for Phase 5's CSV upload (a GLOBAL setting, not scoped to that
  // one action), so an unbounded password field would otherwise let an anonymous
  // caller force this action to buffer/argon2-hash an arbitrarily large string per
  // attempt. 200 chars comfortably covers any real passphrase.
  password: z.string().min(1).max(200),
});

export type LoginState = { error?: string } | undefined;

async function getClientIp(): Promise<string> {
  const hdrs = await headers();
  const forwardedFor = hdrs.get('x-forwarded-for');
  if (!forwardedFor) {
    // Local dev has no proxy in front, so this header is absent there — rate-limiting
    // still works locally, just keyed on one shared bucket.
    return 'unknown';
  }
  // Trust only the LAST hop, not the client-suppliable first value. Each proxy in a
  // forwarding chain appends the IP it received the request from, so the last entry is
  // what our own edge (Vercel) actually observed — a client can put anything it wants
  // in the entries before that. Trusting the first (naive) value would let an attacker
  // defeat the login rate limiter below entirely by sending a fresh fake IP on every
  // attempt. This assumes exactly one trusted proxy hop (Vercel's edge); a deployment
  // behind additional proxies would need to trust further back in the list.
  const hops = forwardedFor.split(',').map((hop) => hop.trim());
  return hops[hops.length - 1] || 'unknown';
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: 'Enter a valid email and password.' };
  }
  const { email, password } = parsed.data;
  const ip = await getClientIp();

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

  if (isRateLimited(recentAttempts)) {
    return { error: 'Too many attempts. Try again in a few minutes.' };
  }

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  // Same generic message either way — never reveal whether the email exists (spec.md
  // threat notes call out takeover/enumeration risk on the auth surface generally).
  const genericError: LoginState = { error: 'Invalid email or password.' };

  // verifyPassword always runs, even when there's no such user — against a fixed dummy
  // hash in that case — so both branches pay the same argon2 cost. Returning
  // immediately for a nonexistent email (skipping the slow hash) would let an attacker
  // enumerate valid emails purely from response latency, despite the identical message.
  const validPassword = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
  await db.insert(loginAttempts).values({ email, ip, success: Boolean(user) && validPassword });

  if (!user || !validPassword) {
    return genericError;
  }

  await createSession(user.id);
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  await deleteSession();
  redirect('/login');
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  // No upper bound conflicts with validatePassword's own policy (min length only,
  // "no complexity requirements" by design) — .max(200) is the same defense-in-depth
  // bound as loginSchema's password field, not a new password-strength rule.
  newPassword: z.string().max(200),
});

export type ChangePasswordState = { error?: string; success?: boolean } | undefined;

export async function changePasswordAction(
  _prevState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireUser();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
  });
  if (!parsed.success) {
    return { error: 'Both fields are required.' };
  }

  const validation = validatePassword(parsed.data.newPassword);
  if (!validation.valid) {
    return { error: validation.message };
  }

  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const dbUser = rows[0];
  if (!dbUser) {
    return { error: 'Something went wrong. Try again.' };
  }

  const validCurrent = await verifyPassword(dbUser.passwordHash, parsed.data.currentPassword);
  if (!validCurrent) {
    return { error: 'Current password is incorrect.' };
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));

  // Revoke every OTHER active session for this user — a stolen session cookie must not
  // survive the victim changing their password, which is otherwise the standard remedy
  // for "someone else might have my session." The current session (the one making this
  // request) is deliberately kept alive so the user isn't logged out by changing their
  // own password.
  const cookieStore = await cookies();
  const currentToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!currentToken) {
    // requireUser() above only succeeds via a valid session cookie read from this same
    // request-scoped cookie store, so this is unreachable in practice. Throwing (rather
    // than silently falling back to "delete every session, including this one") makes
    // that invariant loud if it's ever violated, instead of quietly logging the
    // requesting user out as a side effect of changing their own password.
    throw new Error('changePasswordAction: no session token on an authenticated request.');
  }
  await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, currentToken)));

  return { success: true };
}
