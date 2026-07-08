import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from './lib/db';
import { sessions, users } from './lib/db/schema';
import { isExpired, shouldRenew, newExpiry } from './lib/auth/session-rules';
import { sessionCookieOptions, SESSION_COOKIE_NAME } from './lib/auth/session';
import { logger } from './lib/log';

// Replaces middleware.ts as of Next.js 16 (file convention renamed; see
// node_modules/next/dist/docs/.../file-conventions/proxy.md). Runs on the Node.js
// runtime by default, which is what makes a real DB-backed session check here viable —
// under the old Edge-only Middleware this app's pg-based session store couldn't have
// run here at all.
//
// This performs the REAL session check (not just an optimistic cookie-presence check,
// which is what Next's own docs suggest for Proxy) because our scale (a handful of
// household members, not internet-scale traffic) makes the extra DB round trip
// negligible, and it lets Proxy also own sliding-expiry renewal — the one place in the
// app that's actually allowed to write a refreshed cookie on every navigation (Server
// Components can't: see lib/auth/session.ts). Server Actions still independently call
// requireUser()/requireRole() (lib/auth/guards.ts) — Next's own docs are explicit that
// Proxy must never be the only line of defense, since a matcher change or a Server
// Action moved to an unmatched route would silently remove this coverage.

const PUBLIC_ROUTES = new Set(['/login']);

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.has(pathname) || pathname.startsWith('/invite/');
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  let validSession: { expiresAt: Date } | null = null;
  if (token) {
    try {
      const rows = await db
        .select({ expiresAt: sessions.expiresAt })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.id, token))
        .limit(1);
      const row = rows[0];
      if (row && !isExpired(row.expiresAt)) {
        validSession = row;
      }
    } catch (err) {
      // Fail closed on a DB error — a transient outage must never be treated as "the
      // user is authenticated." Logged so an actual outage is visible, not silent.
      logger.error({ err }, 'proxy: session lookup failed, treating request as unauthenticated');
    }
  }

  const authenticated = validSession !== null;

  if (!authenticated && !isPublicRoute(pathname)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (authenticated && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const response = NextResponse.next();

  if (authenticated && token && validSession && shouldRenew(validSession.expiresAt)) {
    const newExpiresAt = newExpiry();
    try {
      await db.update(sessions).set({ expiresAt: newExpiresAt }).where(eq(sessions.id, token));
      response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(newExpiresAt));
    } catch (err) {
      // Renewal failing isn't fatal — the session just expires on its original
      // schedule instead of sliding forward. Log and let the request proceed.
      logger.error({ err }, 'proxy: session renewal failed');
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
