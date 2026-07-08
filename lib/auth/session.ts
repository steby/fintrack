import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { sessions, users, type roleEnum } from '../db/schema';
import { generateToken } from './token';
import { newExpiry, isExpired } from './session-rules';
import { env } from '../env';
import { logger } from '../log';

export const SESSION_COOKIE_NAME = 'session';

export interface SessionUser {
  id: string;
  householdId: string;
  email: string;
  name: string;
  role: (typeof roleEnum.enumValues)[number];
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    // Next's own docs recommend `secure: true` unconditionally, but that would break
    // login entirely in local dev over plain http — gate on NODE_ENV instead (spec.md
    // edge case: "cookie over http in dev vs https in prod").
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

// Server Action only — cookies().set() throws if called during a Server Component
// render (Next.js restriction; see node_modules/next/dist/docs .../functions/cookies.md).
export async function createSession(userId: string): Promise<void> {
  const token = generateToken();
  const expiresAt = newExpiry();
  await db.insert(sessions).values({ id: token, userId, expiresAt });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt));
}

// Read-only lookup (no cookie/DB writes) — safe to call from Server Components as well
// as Server Actions. Sliding-expiry renewal happens in proxy.ts instead, which runs on
// (almost) every request and is allowed to write response cookies; keeping this
// function write-free means it never hits the "cookies().set() during render" error.
// Memoized per request via React's cache() so multiple calls in one render/action pass
// (e.g. a layout AND a page both needing the current user) share one DB round trip —
// this cache is request-scoped, not a cross-request singleton.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  // Fails closed on a DB error, matching proxy.ts's identical query — a transient
  // outage must never crash the calling render/action, and must never be treated as
  // "authenticated" either.
  try {
    const rows = await db
      .select({
        expiresAt: sessions.expiresAt,
        userId: users.id,
        householdId: users.householdId,
        email: users.email,
        name: users.name,
        role: users.role,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, token))
      .limit(1);

    const row = rows[0];
    if (!row || isExpired(row.expiresAt)) return null;

    return {
      id: row.userId,
      householdId: row.householdId,
      email: row.email,
      name: row.name,
      role: row.role,
    };
  } catch (err) {
    logger.error({ err }, 'getSessionUser: session lookup failed, treating as unauthenticated');
    return null;
  }
});

// Server Action only (same cookie-write restriction as createSession).
export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.id, token));
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
}
