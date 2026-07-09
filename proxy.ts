import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from './lib/db';
import { sessions } from './lib/db/schema';
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
      // No join to `users` — sessions.userId has a FK to users.id, so a session row
      // can never reference a nonexistent user; joining just to prove what the FK
      // already guarantees would be pure waste on the single hottest query in the app
      // (runs on every navigation).
      const rows = await db
        .select({ expiresAt: sessions.expiresAt })
        .from(sessions)
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

  // Explicit 303 (See Other), not the default 307 (Temporary Redirect). 307 preserves
  // the original method AND body — for an unauthenticated Server Action POST (which
  // carries a Next-Action header/encoded action reference targeting a specific action
  // on the CURRENT route), a 307 would make the browser replay that exact POST against
  // /login, which doesn't have that action registered, producing a Next.js "Failed to
  // find Server Action" error instead of a clean logged-out redirect. 303 always
  // converts the follow-up request to a plain GET, which is what a redirect-to-a-
  // different-page should do here regardless of what triggered it.
  if (!authenticated && !isPublicRoute(pathname)) {
    return NextResponse.redirect(new URL('/login', request.url), 303);
  }

  if (authenticated && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url), 303);
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
  // manifest.webmanifest/icon/apple-icon/icons/sw.js (Phase 7 PWA assets) are static
  // and deploy-scoped, not user-scoped — a browser fetches the manifest and icons for
  // an install prompt, and registers sw.js, before any login happens (most visibly on
  // /login itself), so they must never redirect for lack of a session, same as the
  // pre-existing static/health exclusions below.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/health|manifest.webmanifest|icon|apple-icon|sw.js).*)',
  ],
};
