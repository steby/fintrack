// Minimal service worker: cache-first for immutable static assets ONLY. Every other
// request (navigation/HTML, RSC payloads, /api/*, /login, /settings/*, etc.) is left
// completely untouched — the fetch handler returns without calling
// event.respondWith(), so the browser makes the request exactly as if no service
// worker were installed.
//
// Load-bearing gotcha (spec.md Phase 7 edge case): this app has no static, logged-out
// pages — every route is either an authed page scoped to one household or a public
// auth page whose content depends on live session state (e.g. an error message).
// Caching any of that with a stale-while-revalidate or network-falling-back-to-cache
// strategy risks serving one user's page (or a stale permission/error state) to the
// next person on a shared device after logout. A future edit that "simplifies" this
// into caching navigation requests would reintroduce that bug — don't.
//
// KNOWN LIMITATION, not auto-fixed: this file is served verbatim from public/ (no
// build step touches it), so CACHE_NAME can't be derived from a build id/content hash
// the way /_next/static/* asset URLs are. If a static PWA asset actually changes
// (e.g. lib/pwa/icon.tsx's glyph, or app/manifest.ts's fields), a browser that already
// cached the old response under this same name will keep serving it until this string
// is bumped by hand (e.g. 'fintrack-static-v2') in the same commit — activate()'s
// cleanup below only clears caches whose name differs from the CURRENT one, so nothing
// happens automatically otherwise. A real fix (deriving this from something that
// changes every deploy) needs a codegen/templating step this app doesn't have; that's
// more build-pipeline complexity than a household app's static icon caching warrants
// today (see PROGRESS.md's Phase 7 code-review entry for the full reasoning).
const CACHE_NAME = 'fintrack-static-v1';

// /_next/static/* is content-hashed and immutable per build (safe to cache forever).
// The rest are this app's own generated icon/manifest routes (app/icon.tsx,
// app/apple-icon.tsx, app/icons/{192,512}/route.tsx, app/manifest.ts) — deterministic
// per deploy, not per user, so equally safe to cache-first.
//
// Kept in sync BY HAND with proxy.ts's matcher exclusion list (same underlying set of
// "static PWA asset" paths, described independently in two files that run in
// completely different runtimes — this one's a plain browser-side script Next never
// bundles, proxy.ts is compiled Node/Edge code — so they can't share one literal
// module without adding a codegen step). If you add a new static PWA route, add it to
// BOTH lists, or it either silently stops being cached (forgotten here) or silently
// bypasses the session check (forgotten in proxy.ts, the "manifest.webmanifest"
// 404-behind-login bug from earlier in this same phase, in miniature).
function isCacheableStatic(url) {
  if (url.origin !== self.location.origin) return false;
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/icon' ||
    url.pathname === '/apple-icon' ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/manifest.webmanifest'
  );
}

self.addEventListener('install', () => {
  // No precache list to manage (build-hashed filenames change every deploy); assets
  // populate the cache opportunistically on first fetch instead. Take over from any
  // previous worker immediately — safe here specifically because this worker never
  // caches anything version-sensitive (see isCacheableStatic).
  self.skipWaiting();
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
      // coupling its outcome to the response the page actually receives. The `.catch`
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
