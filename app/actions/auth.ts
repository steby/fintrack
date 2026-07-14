'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers, cookies } from 'next/headers';
import { eq, and, ne, gte, sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { users, loginAttempts, sessions } from '../../lib/db/schema';
import {
  verifyPassword,
  hashPassword,
  validatePassword,
  DUMMY_PASSWORD_HASH,
} from '../../lib/auth/password';
import { createSession, deleteSession, SESSION_COOKIE_NAME } from '../../lib/auth/session';
import { hashToken } from '../../lib/auth/token';
import { isRateLimited, LOGIN_RATE_LIMIT_WINDOW_MS } from '../../lib/auth/rate-limit';
import { requireUser } from '../../lib/auth/guards';
import { normalizeEmail, emailEquals } from '../../lib/auth/email';

const loginSchema = z.object({
  // Normalized here, at the parse boundary, so every subsequent use of
  // parsed.data.email in this action (rate-limit lookup/insert, user lookup) is
  // already consistent — see lib/auth/email.ts for why this exists (a user created via
  // a mixed-case invite couldn't log in typing the lowercase form of their own email).
  email: z.string().email().transform(normalizeEmail),
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

  // Same generic message either way — never reveal whether the email exists (spec.md
  // threat notes call out takeover/enumeration risk on the auth surface generally).
  const genericError: LoginState = { error: 'Invalid email or password.' };

  // The rate-limit SELECT and the loginAttempts INSERT below used to be two separate,
  // unguarded statements — a burst of concurrent requests for the same (email, ip)
  // could all run the SELECT (all seeing zero prior attempts) before any of them ran
  // the INSERT, defeating the cap entirely regardless of how many attempts fired at
  // once. pg_advisory_xact_lock serializes the whole check-hash-record sequence per
  // (email, ip): the second attempt's SELECT can't even START until the first
  // attempt's transaction (including its INSERT) has committed, so it correctly sees
  // every attempt that came before it. Released automatically at transaction end
  // (commit OR rollback) — no separate unlock call needed. Two independent int4 keys
  // (hashtext(email), hashtext(ip)), not one concatenated string, so there's no
  // ambiguity between e.g. email="a", ip="bc" and email="ab", ip="c" both hashing the
  // concatenation "abc" — a collision here would just serialize two unrelated
  // attempts against each other, not a security bypass, but the two-key form avoids
  // it for free. createSession()/redirect() deliberately stay OUTSIDE this
  // transaction: redirect() throws a special Next.js control-flow signal, not a real
  // error, and letting that propagate through an open db.transaction() would make
  // drizzle roll back everything inside it (including the loginAttempts row this
  // transaction just committed) as if login itself had failed.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${email}), hashtext(${ip}))`);

    const recentAttempts = await tx
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
      return { kind: 'rate-limited' } as const;
    }

    // Case-insensitive: emailEquals (not eq) so a user whose row happens to predate
    // normalizeEmail (or any account created before this fix) is still found
    // correctly, with no data migration required — see lib/auth/email.ts.
    const rows = await tx.select().from(users).where(emailEquals(users.email, email)).limit(1);
    const user = rows[0];

    // verifyPassword always runs, even when there's no such user — against a fixed
    // dummy hash in that case — so both branches pay the same argon2 cost. Returning
    // immediately for a nonexistent email (skipping the slow hash) would let an
    // attacker enumerate valid emails purely from response latency, despite the
    // identical message.
    const validPassword = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
    await tx.insert(loginAttempts).values({ email, ip, success: Boolean(user) && validPassword });

    if (!user || !validPassword) {
      return { kind: 'invalid' } as const;
    }
    return { kind: 'success', userId: user.id } as const;
  });

  if (outcome.kind === 'rate-limited') {
    return { error: 'Too many attempts. Try again in a few minutes.' };
  }
  if (outcome.kind === 'invalid') {
    return genericError;
  }

  await createSession(outcome.userId);
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
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, user.id), ne(sessions.id, hashToken(currentToken))));

  return { success: true };
}

const updateNameSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
});

export type UpdateNameState = { error?: string; success?: boolean } | undefined;

// Every account is created with a real name EXCEPT the very first one, seeded by
// lib/db/seed.ts with the literal placeholder 'Owner' (it has no way to know the real
// person's name at seed time) — every other user gets their real name from the invite
// flow. This was the only path in the whole app that could ever leave a display name
// stuck at that placeholder, with nowhere to change it.
export async function updateNameAction(
  _prevState: UpdateNameState,
  formData: FormData,
): Promise<UpdateNameState> {
  const user = await requireUser();

  const parsed = updateNameSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid name.' };
  }

  await db.update(users).set({ name: parsed.data.name }).where(eq(users.id, user.id));

  // The name renders in the sidebar/bottom-nav footer and the Settings hub header on
  // EVERY page (app/(app)/layout.tsx, settings/page.tsx), not just this one — a
  // path-scoped revalidate would leave it stale everywhere except account/page.tsx
  // until some other navigation happened to refresh the shared layout.
  revalidatePath('/', 'layout');

  return { success: true };
}
