import { WifiOff } from 'lucide-react';
import { OfflineRetryButton } from './retry-button';

// The service worker's navigation fallback (app/sw.js/route.ts): precached at install,
// served ONLY when a navigation's network fetch fails. Deliberately static and
// data-free — it renders identically for everyone, which is exactly what makes it safe
// to cache under the SW's "never cache authed HTML" policy (public route, proxy.ts).
export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <WifiOff className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        FinTrack needs a connection to show your live numbers. Reconnect and try again.
      </p>
      {/* A full-page load, not client-side navigation — the router can't help while
          offline; window.location.href is exactly the "reload and retry" this needs.
          (An `<a href="/">` would be simpler still, but @next/next/no-html-link-for-pages
          errors on it; role/keyboard semantics are equivalent on a real <button>.) */}
      <OfflineRetryButton />
    </div>
  );
}
