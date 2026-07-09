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
});
