import { test, expect } from '@playwright/test';

// Phase 0 smoke coverage: the harness is wired end to end before any feature code exists.
// The "login page renders" check from spec.md's Phase 0 plan is added once Phase 1 ships
// an actual login page; today's root route is still the default scaffold page.
test('health check endpoint reports ok with the database reachable', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ ok: true, db: 'up' });
});

test('root page renders without error', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBeLessThan(400);
});
