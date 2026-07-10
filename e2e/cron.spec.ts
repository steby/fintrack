import 'dotenv/config';
import { test, expect } from '@playwright/test';

// Regression coverage for a real production bug: proxy.ts's matcher didn't exclude
// api/cron/*, so Vercel Cron's request (Authorization: Bearer <CRON_SECRET>, no
// session cookie) was 303-redirected to /login before verifyCronRequest() — each
// route's OWN, correct auth check — ever ran. No cron job ever actually executed.
// Integration tests never caught this: they import and call the route handlers
// directly, bypassing Proxy entirely. Only a real HTTP hit through the actual running
// server (which is what Playwright's `request` fixture does, unlike Vitest) exercises
// the matcher the way Vercel's real traffic does — the Playwright test runner is a
// separate Node process from the app's own webServer (see playwright.config.ts), so
// this needs its own `dotenv/config` import to see CRON_SECRET (same as e2e/test-db.ts).
const CRON_SECRET = process.env.CRON_SECRET;

test.describe('cron routes are reachable and correctly authenticated through the real server', () => {
  for (const route of ['/api/cron/generate', '/api/cron/reminders', '/api/cron/recap']) {
    test(`${route}: a valid CRON_SECRET reaches the route handler, not /login`, async ({
      request,
    }) => {
      // /api/cron/generate loops every household doing real (if idempotent) DB work
      // per one — on a dev DB with decades of accumulated test households this alone
      // can take tens of seconds, well past Playwright's 30s default. Not this test's
      // concern to fix (see the N+1-per-household finding tracked separately); just
      // needs enough headroom to prove the route is REACHABLE at all, which is what
      // this test actually verifies.
      test.setTimeout(90_000);

      // maxRedirects: 0 so a reintroduced Proxy bug shows up as an actual 303
      // response here to inspect, rather than Playwright silently following it to
      // /login's 200 and masking the regression.
      const response = await request.get(route, {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body).not.toHaveProperty('error');
    });

    test(`${route}: a missing/wrong secret gets the route's own 401, not a redirect to /login`, async ({
      request,
    }) => {
      const response = await request.get(route, {
        headers: { authorization: 'Bearer wrong-secret' },
        maxRedirects: 0,
      });
      // Proves the route is reachable (not proxy-blocked) AND still genuinely
      // protected — a 303 here would mean Proxy caught it before the route's own
      // check could return the correct 401.
      expect(response.status()).toBe(401);
    });
  }
});
