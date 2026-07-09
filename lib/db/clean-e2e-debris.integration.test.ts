import { describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from './index';
import { households, users } from './schema';
import { cleanOrphanedHouseholds } from './clean-e2e-debris';

// Exercises cleanOrphanedHouseholds directly against a real (local/dev) DB — safe to
// do, unlike running the full script, because this function takes `db` and
// `seedOwnerEmail` as plain arguments rather than going through main()'s hard
// `CI !== 'true'` guard or reading the real SEED_OWNER_EMAIL.
//
// Deliberately anchored in 2020, years before this project existed — NOT "today minus
// an hour" — so the computed cutoff can never fall after any *real* row's createdAt
// (everything genuine in this DB was created in/after 2026). A real household is only
// ever "older than cutoff" if cutoff is in its future; anchoring `now` safely in the
// past means only this test's own synthetic fixtures (created with an explicit, equally
// old `createdAt`) can ever be candidates for deletion. Getting this wrong would delete
// real local dev data, not just test debris — worth the extra care.
const NOW = new Date('2020-01-01T00:00:00Z');
// Paired with clean-e2e-debris.ts's TEMPORARY (2026-07-10) threshold — revert both
// together once a clean CI run confirms the one-time remediation worked.
const ONE_HOUR_MS = 5 * 60 * 1000;

async function makeHousehold(label: string, createdAt: Date) {
  const [household] = await db.insert(households).values({ name: label, createdAt }).returning();
  return household;
}

async function cleanup(...householdIds: string[]) {
  await db.delete(households).where(inArray(households.id, householdIds));
}

describe('cleanOrphanedHouseholds', () => {
  it('deletes a household older than 1 hour, keeps a recent one', async () => {
    const old = await makeHousehold(
      'Orphan test OLD',
      new Date(NOW.getTime() - ONE_HOUR_MS - 1000),
    );
    const recent = await makeHousehold('Orphan test RECENT', new Date(NOW.getTime() - 1000));

    const result = await cleanOrphanedHouseholds(db, undefined, NOW);
    expect(result.orphanedHouseholds).toBeGreaterThanOrEqual(1);

    const [oldRow] = await db.select().from(households).where(eq(households.id, old.id));
    const [recentRow] = await db.select().from(households).where(eq(households.id, recent.id));
    expect(oldRow).toBeUndefined();
    expect(recentRow).toBeDefined();

    await cleanup(recent.id);
  });

  it('never deletes the seed owner’s household, even though it is old', async () => {
    const seedOwnerEmail = `orphan-test-seed-owner-${Date.now()}@example.com`;
    const seedHousehold = await makeHousehold(
      'Orphan test SEED',
      new Date(NOW.getTime() - ONE_HOUR_MS - 1000),
    );
    await db.insert(users).values({
      householdId: seedHousehold.id,
      email: seedOwnerEmail,
      passwordHash: 'x',
      name: 'Seed Owner',
      role: 'owner',
    });
    const otherOld = await makeHousehold(
      'Orphan test OTHER OLD',
      new Date(NOW.getTime() - ONE_HOUR_MS - 1000),
    );

    const result = await cleanOrphanedHouseholds(db, seedOwnerEmail, NOW);
    expect(result.orphanedHouseholds).toBeGreaterThanOrEqual(1);
    expect(result.skippedUnverifiedSeedOwner).toBe(false);

    const [seedRow] = await db.select().from(households).where(eq(households.id, seedHousehold.id));
    const [otherRow] = await db.select().from(households).where(eq(households.id, otherOld.id));
    expect(seedRow).toBeDefined(); // survives despite being old, because it's the seed owner's
    expect(otherRow).toBeUndefined(); // equally old, no exclusion — deleted

    await cleanup(seedHousehold.id);
  });

  it('fails CLOSED — deletes nothing — when seedOwnerEmail is configured but no user matches it', async () => {
    const unmatchedEmail = `orphan-test-unmatched-${Date.now()}@example.com`;
    const old = await makeHousehold(
      'Orphan test UNVERIFIED SEED',
      new Date(NOW.getTime() - ONE_HOUR_MS - 1000),
    );

    const result = await cleanOrphanedHouseholds(db, unmatchedEmail, NOW);
    expect(result.orphanedHouseholds).toBe(0);
    expect(result.skippedUnverifiedSeedOwner).toBe(true);

    // Nothing was deleted at all — not even the genuinely-old, unrelated household —
    // because the sweep was skipped entirely rather than running unprotected.
    const [row] = await db.select().from(households).where(eq(households.id, old.id));
    expect(row).toBeDefined();

    await cleanup(old.id);
  });

  it('does not throw and still deletes old households when no seed owner email is configured', async () => {
    const old = await makeHousehold(
      'Orphan test NO SEED EMAIL',
      new Date(NOW.getTime() - ONE_HOUR_MS - 1000),
    );

    const result = await cleanOrphanedHouseholds(db, undefined, NOW);
    expect(result.orphanedHouseholds).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(households).where(eq(households.id, old.id));
    expect(row).toBeUndefined();
  });

  it('is idempotent: a second call with no new debris deletes nothing', async () => {
    const old = await makeHousehold(
      'Orphan test IDEMPOTENT',
      new Date(NOW.getTime() - ONE_HOUR_MS - 1000),
    );

    const first = await cleanOrphanedHouseholds(db, undefined, NOW);
    expect(first.orphanedHouseholds).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(households).where(eq(households.id, old.id));
    expect(row).toBeUndefined();

    const second = await cleanOrphanedHouseholds(db, undefined, NOW);
    expect(second.orphanedHouseholds).toBe(0);
  });

  it('keeps a household exactly at the 1-hour boundary (not yet strictly older)', async () => {
    const boundary = await makeHousehold(
      'Orphan test BOUNDARY',
      new Date(NOW.getTime() - ONE_HOUR_MS),
    );

    await cleanOrphanedHouseholds(db, undefined, NOW);

    const [row] = await db.select().from(households).where(eq(households.id, boundary.id));
    expect(row).toBeDefined();

    await cleanup(boundary.id);
  });
});
