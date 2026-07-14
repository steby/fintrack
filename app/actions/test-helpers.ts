import { eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { households, users, sessions } from '../../lib/db/schema';
import { generateToken, hashToken } from '../../lib/auth/token';
import { newExpiry } from '../../lib/auth/session-rules';

// Shared by every app/actions/*.integration.test.ts file that exercises an
// already-authenticated Server Action (all of them except auth.integration.test.ts,
// which needs a real hashed password and no pre-existing session, since it tests
// login itself — a genuinely different fixture shape, not just a copy-paste target).
// vi.mock('server-only'/'next/cache'/'next/headers') calls and each file's own
// `mockToken` variable stay local to each test file — Vitest hoists vi.mock calls
// found directly in the test file source, so they can't be re-exported from here.
export async function makeHouseholdWithUser(role: 'owner' | 'member' | 'viewer', label: string) {
  const [household] = await db.insert(households).values({ name: label }).returning();
  const [user] = await db
    .insert(users)
    .values({
      householdId: household.id,
      email: `${label.replace(/\s+/g, '-')}-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: 'x',
      name: role,
      role,
    })
    .returning();
  const token = generateToken();
  // Mirrors createSession: the row stores the HASH; the raw token is what each test
  // file's cookies mock presents — fixtures exercise the same hash-on-lookup path
  // production uses.
  await db
    .insert(sessions)
    .values({ id: hashToken(token), userId: user.id, expiresAt: newExpiry() });
  return { household, user, token };
}

export function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

export async function cleanup(...householdIds: string[]) {
  for (const id of householdIds) {
    await db.delete(households).where(eq(households.id, id));
  }
}
