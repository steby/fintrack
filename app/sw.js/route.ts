import { STATIC_PWA_EXACT_PATHS, STATIC_PWA_PREFIX_PATHS } from '../../lib/pwa/static-paths';

// Not the `public/sw.js` static-file convention anymore — a Route Handler instead, so
// this can (a) import the SAME STATIC_PWA_EXACT_PATHS/STATIC_PWA_PREFIX_PATHS proxy.ts
// derives its matcher from (one source, not two independently hand-typed lists), and
// (b) derive CACHE_NAME from something that actually changes every real deploy, which
// a file served verbatim from public/ never could. Statically rendered once per build
// (`dynamic = 'force-static'`) — the script's content only depends on build-time
// values (the commit SHA, the shared path lists), never per-request data, so there's
// no reason to regenerate it on every fetch.
export const dynamic = 'force-static';

// VERCEL_GIT_COMMIT_SHA is set by Vercel's build environment (unset locally, where
// `next dev`/`next build` fall back to a fixed string — cache-busting across local
// rebuilds was never the problem this solves, only across real deploys).
const CACHE_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'local-dev';

// A plain constant, not a function: buildScript() had no parameter and closed only over
// already-resolved module-scope values (CACHE_VERSION, the two path arrays), so calling
// it was pure indirection — dynamic = 'force-static' above means this whole module only
// ever evaluates once per build anyway.
//
// Escaping gotcha: this is ONE outer template literal containing the entire generated
// script below, including its own prose comments. Any backtick typed into one of those
// inner comments — this codebase's normal way to quote an identifier, used freely
// elsewhere in this file and in proxy.ts/static-paths.ts — closes the OUTER literal
// early unless escaped (see the already-escaped `` \`.catch\` `` a few dozen lines down).
// A future comment added here without escaping its backticks breaks this file at build
// time at best, silently truncates the shipped service worker at worst.
const SW_SCRIPT: string = `// Minimal service worker: cache-first for immutable static assets, plus ONE precached
// public fallback page (/offline) served when a NAVIGATION's network fetch fails.
// Every other request (RSC payloads, /api/*, Server Actions, etc.) is left completely
// untouched — the fetch handler returns without calling event.respondWith(), so the
// browser makes the request exactly as if no service worker were installed.
//
// Load-bearing gotcha (spec.md Phase 7 edge case): this app has no static, logged-out
// pages — every route is either an authed page scoped to one household or a public
// auth page whose content depends on live session state (e.g. an error message).
// Caching any of that with a stale-while-revalidate or network-falling-back-to-cache
// strategy risks serving one user's page (or a stale permission/error state) to the
// next person on a shared device after logout. A future edit that "simplifies" this
// into caching navigation RESPONSES would reintroduce that bug — don't. The offline
// fallback below does NOT violate this policy: navigations are network-ONLY (their
// responses are never cache.put anywhere); the only thing ever served from cache for
// a navigation is /offline, a static page that renders identically for everyone and
// contains no personal data by construction (see app/offline/page.tsx).
//
// CACHE_NAME is generated at BUILD TIME from the deploying commit (see
// app/sw.js/route.ts) — a real static PWA asset change (e.g. lib/pwa/icon.tsx's
// glyph, or app/manifest.ts's fields) ships in a commit, which changes this value
// automatically, so activate()'s cleanup below actually clears the old cache on the
// next deploy instead of needing a hand-typed version bump.
const CACHE_NAME = 'fintrack-static-${CACHE_VERSION}';

// Generated from lib/pwa/static-paths.ts — the SAME list proxy.ts's matcher derives
// its session-check exclusions from. This script runs entirely in the browser
// (Next.js never bundles it), so it can't import that module directly; these are its
// values, serialized at build time instead.
const STATIC_EXACT_PATHS = ${JSON.stringify(STATIC_PWA_EXACT_PATHS)};
const STATIC_PREFIX_PATHS = ${JSON.stringify(STATIC_PWA_PREFIX_PATHS)};

// /_next/static/* is content-hashed and immutable per build (safe to cache forever) —
// framework-reserved, not part of the shared PWA path list (see proxy.ts's matcher
// comment for why it's excluded the same way, independently, on that side too).
function isCacheableStatic(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/_next/static/')) return true;
  return (
    STATIC_EXACT_PATHS.includes(url.pathname) ||
    STATIC_PREFIX_PATHS.some((prefix) => url.pathname.startsWith(prefix))
  );
}

const OFFLINE_FALLBACK = '/offline';

self.addEventListener('install', (event) => {
  // The ONE precached entry: the public, data-free offline fallback page. Everything
  // else (build-hashed static assets) populates the cache opportunistically on first
  // fetch — no precache list of hashed filenames to manage. cache.add({cache:
  // 'reload'}) bypasses the HTTP cache so a fresh copy ships with every new worker.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache
        .add(new Request(OFFLINE_FALLBACK, { cache: 'reload' }))
        .catch(() => {}); // a failed precache must not brick installation
      // Take over from any previous worker immediately — safe here specifically
      // because this worker never caches anything version-sensitive
      // (see isCacheableStatic) beyond the fallback it just refreshed.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Navigations: network-ONLY, with the precached /offline page as the sole fallback.
  // The live response is deliberately never written to any cache (see the policy
  // comment at the top) — this branch only changes what a FAILED fetch shows: a
  // friendly page instead of the browser's dinosaur.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const fallback = await cache.match(OFFLINE_FALLBACK);
        // Response.error() when even the fallback is missing (e.g. precache failed
        // and the very first navigation is offline) — equivalent to no SW at all.
        return fallback ?? Response.error();
      }),
    );
    return;
  }

  const url = new URL(event.request.url);
  if (!isCacheableStatic(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) return cached;

      const response = await fetch(event.request);
      // event.waitUntil(), not an inline await: respondWith()'s own promise controls
      // how long the browser waits for the RESPONSE, so awaiting the cache write here
      // would (a) add its latency to every cache-miss request, and (b) let a rejected
      // write (e.g. QuotaExceededError) reject respondWith()'s promise too — which the
      // Service Worker spec treats as a hard network failure, discarding a response
      // that was already fetched successfully. waitUntil() extends the WORKER's
      // lifetime independently, so the write still can't be silently cut off, without
      // coupling its outcome to the response the page actually receives. The \`.catch\`
      // is required for the same reason: an uncaught rejection inside waitUntil() is
      // reported as an unhandled rejection but doesn't affect the response — the only
      // thing worth doing on failure here is not crashing.
      if (response.ok) {
        event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
      }
      return response;
    })(),
  );
});
`;

export async function GET() {
  return new Response(SW_SCRIPT, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Browsers already re-check a registered service worker for byte-level changes
      // on their own schedule (spec-defined, roughly per navigation / at least every
      // 24h) — this just stops an HTTP-level cache from ever masking a real change
      // between those checks.
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
