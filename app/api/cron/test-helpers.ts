import { vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { households, users } from '../../../lib/db/schema';

// Shared fixtures for the three cron route integration test files
// (generate/recap/reminders route.integration.test.ts), which each independently
// redeclared identical versions of everything below before this extraction.

// Low-entropy repeated-character value, not an English-phrase-like string — matches
// lib/auth/cron.test.ts's convention, deliberately chosen so gitleaks' generic-api-key
// entropy heuristic doesn't flag an obviously-fake test fixture as a real secret.
export const CRON_SECRET = 'a'.repeat(40);

export async function makeHousehold(label: string) {
  const [household] = await db.insert(households).values({ name: label }).returning();
  return household;
}

export async function makeRecipient(householdId: string, label: string) {
  const [user] = await db
    .insert(users)
    .values({
      householdId,
      email: `${label.replace(/\s+/g, '-')}-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: 'x',
      name: label,
      role: 'member',
      notifyByEmail: true,
    })
    .returning();
  return user;
}

export async function cleanupHousehold(householdId: string) {
  await db.delete(households).where(eq(households.id, householdId));
}

// Mocks lib/env for a cron route test. Callers still do their own `await
// import('./route')` immediately after — that import path is relative to the CALLING
// test file, not this shared helper, so it can't be centralized here too.
export function mockCronEnv(overrides: Record<string, unknown> = {}) {
  vi.doMock('../../../lib/env', () => ({
    env: { CRON_SECRET, RESEND_API_KEY: undefined, ...overrides },
  }));
  vi.resetModules();
}
