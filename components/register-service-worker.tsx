'use client';

import { useEffect } from 'react';

/** Registers public/sw.js once, client-side only. Nothing to do on logout: the worker
 *  never caches authed pages or API responses (see sw.js's top-of-file comment), so
 *  there's no stale per-user state to purge when a session ends. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installability is a progressive enhancement, not a hard requirement — a
      // failed registration (e.g. an unsupported browser edge case) shouldn't
      // surface to the user or block anything else on the page.
    });
  }, []);

  return null;
}
