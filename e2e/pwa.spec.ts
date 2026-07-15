import { test, expect } from '@playwright/test';

// spec.md Phase 7 calls for "Lighthouse PWA installability check." Deliberately not the
// `lighthouse`/`playwright-lighthouse` package: that's a heavy dependency (launches its
// own Chrome instance, adds real CI time and flakiness risk) for what installability
// actually boils down to — a handful of concrete, deterministic facts about the
// manifest, icons, and service worker (see development-workflow.md's "Dependency
// hygiene: justify every new dependency"). This checks exactly the criteria Chrome's
// own installability heuristic (and Lighthouse's `installable-manifest`/
// `service-worker` audits) verify, without the extra dependency weight. spec.md's
// Phase 7 entry documents this substitution.

test.describe('PWA installability', () => {
  test('the manifest is linked, valid, and has the icons Chrome requires to install', async ({
    page,
  }) => {
    await page.goto('/login');

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBeTruthy();

    const manifestResponse = await page.request.get(manifestHref!);
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();

    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    // "standalone" or "fullscreen" — either satisfies Chrome's installability
    // heuristic; "browser" (the MDN default) does not.
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);

    // Chrome requires at least one icon >= 192px AND one >= 512px.
    const sizes: number[] = manifest.icons.map((icon: { sizes: string }) =>
      Number(icon.sizes.split('x')[0]),
    );
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(512);
    expect(sizes.some((s) => s >= 192)).toBe(true);

    for (const icon of manifest.icons as { src: string }[]) {
      const iconResponse = await page.request.get(icon.src);
      expect(iconResponse.ok()).toBe(true);
      expect(iconResponse.headers()['content-type']).toContain('image/');
    }
  });

  test('the manifest and its icons are reachable without a session (installable before login)', async ({
    page,
  }) => {
    // A browser evaluates installability (and iOS evaluates "Add to Home Screen")
    // independent of whether the visitor is logged in — proxy.ts's matcher must never
    // gate these behind auth. Explicitly start from a clean, cookie-free context.
    const manifestResponse = await page.request.get('/manifest.webmanifest');
    expect(manifestResponse.ok()).toBe(true);
    const icon192 = await page.request.get('/icons/192');
    expect(icon192.ok()).toBe(true);
    const icon512 = await page.request.get('/icons/512');
    expect(icon512.ok()).toBe(true);
  });

  test('the service worker registers and controls the page', async ({ page }) => {
    await page.goto('/login');

    const swResponse = await page.request.get('/sw.js');
    expect(swResponse.ok()).toBe(true);

    const registered = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return Boolean(registration.active);
    });
    expect(registered).toBe(true);
  });

  test('an offline navigation gets the precached fallback page, not a browser error', async ({
    page,
    context,
  }) => {
    // /offline itself is public (proxy.ts PUBLIC_ROUTES) and data-free — the ONLY
    // page the worker is allowed to serve from cache for a navigation; live
    // navigation responses are never cached (the SW's load-bearing policy).
    const offlineDirect = await page.request.get('/offline');
    expect(offlineDirect.ok()).toBe(true);

    await page.goto('/login');
    // Wait until the active worker CONTROLS this client — registration alone isn't
    // enough for navigation interception, and install's waitUntil (which precaches
    // /offline) must have completed for the fallback to exist.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        });
      }
    });

    await context.setOffline(true);
    try {
      await page.goto('/monthly');
      await expect(page.getByText(/You(’|')re offline/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
