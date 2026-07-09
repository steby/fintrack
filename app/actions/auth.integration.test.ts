import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../lib/db';
import { households, users, loginAttempts } from '../../lib/db/schema';
import { hashPassword } from '../../lib/auth/password';

// Same Next-runtime-plumbing-replacement pattern as members.integration.test.ts —
// real DB, real loginAction/rate-limit logic, only server-only/next/navigation/
// next/headers swapped for controllable stand-ins. redirect() is never actually hit by
// these tests (every scenario here uses a wrong password, so loginAction returns before
// ever calling createSession/redirect), but auth.ts imports it at module load time
// regardless, so it still needs a mock to avoid a real "next/navigation" resolution
// outside a request context.
let mockForwardedFor: string | undefined;
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => (name === 'x-forwarded-for' ? (mockForwardedFor ?? null) : null),
  }),
  cookies: async () => ({
    get: () => undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

afterAll(async () => {
  await pool.end();
});

afterEach(() => {
  mockForwardedFor = undefined;
});

async function makeHouseholdWithUser(label: string) {
  const [household] = await db.insert(households).values({ name: label }).returning();
  const email = `${label.replace(/\s+/g, '-')}-${Date.now()}-${Math.random()}@example.com`;
  await db.insert(users).values({
    householdId: household.id,
    email,
    passwordHash: await hashPassword('correct-horse-battery-staple'),
    name: 'Owner',
    role: 'owner',
  });
  return { household, email };
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

async function cleanup(householdId: string, email: string) {
  await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
  await db.delete(households).where(eq(households.id, householdId));
}

// getClientIp() itself isn't exported — this is Phase 1's own deliberate fix (trust
// only the LAST X-Forwarded-For hop, not the client-suppliable first one) exercised
// indirectly through loginAction's rate-limiter, which is the only thing that actually
// depends on getClientIp() getting this right. The underlying logic was already
// live-verified once during the Phase 1 hardening pass (a synthetic spoofed header,
// checked by hand) — this closes the gap that verification was never turned into a
// standing regression test.
describe('loginAction — getClientIp / rate-limit IP keying', () => {
  it('keys the rate limiter on the LAST X-Forwarded-For hop, not the client-suppliable first one', async () => {
    const { loginAction } = await import('./auth');
    const { household, email } = await makeHouseholdWithUser('Auth IP A');

    mockForwardedFor = 'attacker-spoofed-ip, real-edge-ip';
    const result = await loginAction(undefined, formData({ email, password: 'wrong-password' }));
    expect(result).toEqual({ error: 'Invalid email or password.' });

    const rows = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0].ip).toBe('real-edge-ip');

    await cleanup(household.id, email);
  });

  it('falls back to "unknown" when X-Forwarded-For is entirely absent (local dev, no proxy)', async () => {
    const { loginAction } = await import('./auth');
    const { household, email } = await makeHouseholdWithUser('Auth IP B');

    mockForwardedFor = undefined;
    await loginAction(undefined, formData({ email, password: 'wrong-password' }));

    const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email));
    expect(row.ip).toBe('unknown');

    await cleanup(household.id, email);
  });

  it('falls back to "unknown" for a malformed header with an empty trailing segment (e.g. a trailing comma)', async () => {
    const { loginAction } = await import('./auth');
    const { household, email } = await makeHouseholdWithUser('Auth IP C');

    mockForwardedFor = 'real-edge-ip,';
    await loginAction(undefined, formData({ email, password: 'wrong-password' }));

    const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email));
    expect(row.ip).toBe('unknown');

    await cleanup(household.id, email);
  });

  it('rotating the spoofed first hop on every attempt does not defeat the lockout — all attempts share one rate-limit bucket via the real last hop', async () => {
    const { loginAction } = await import('./auth');
    const { household, email } = await makeHouseholdWithUser('Auth IP D');

    for (let i = 0; i < 5; i++) {
      mockForwardedFor = `spoofed-ip-${i}, shared-real-ip`;
      await loginAction(undefined, formData({ email, password: 'wrong-password' }));
    }
    // A 6th attempt, again with a freshly-rotated spoofed first hop, must still be
    // rejected by the rate limiter — proving an attacker can't bypass the 5-attempt
    // lockout just by changing the client-suppliable part of the header per request.
    mockForwardedFor = 'yet-another-spoofed-ip, shared-real-ip';
    const result = await loginAction(undefined, formData({ email, password: 'wrong-password' }));
    expect(result).toEqual({ error: 'Too many attempts. Try again in a few minutes.' });

    const rows = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email));
    // Only 5 rows, not 6 — the rate-limited 6th attempt returns early, before ever
    // recording a new loginAttempts row.
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.ip === 'shared-real-ip')).toBe(true);

    await cleanup(household.id, email);
  });
});
