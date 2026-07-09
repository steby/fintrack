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
const CACHE_NAME = 'fintrack-static-v1';

// /_next/static/* is content-hashed and immutable per build (safe to cache forever).
// The rest are this app's own generated icon/manifest routes (app/icon.tsx,
// app/apple-icon.tsx, app/icons/{192,512}/route.tsx, app/manifest.ts) — deterministic
// per deploy, not per user, so equally safe to cache-first.
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
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    })(),
  );
});
