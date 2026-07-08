import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from './db';
import { households, householdSettings } from './db/schema';
import { isEnabled, setFlag } from './flags';

afterAll(async () => {
  await pool.end();
});

async function makeHousehold(label: string) {
  const [household] = await db.insert(households).values({ name: label }).returning();
  return household;
}

async function cleanup(householdId: string) {
  await db.delete(households).where(eq(households.id, householdId));
}

describe('isEnabled', () => {
  it('falls back to the documented default when no row exists', async () => {
    const household = await makeHousehold('Flags default A');

    expect(await isEnabled(household.id, 'auto_generate')).toBe(true);
    expect(await isEnabled(household.id, 'csv_import')).toBe(false);

    await cleanup(household.id);
  });

  it('reads an explicitly stored true/false value', async () => {
    const household = await makeHousehold('Flags explicit A');
    await db.insert(householdSettings).values({
      householdId: household.id,
      key: 'auto_generate',
      value: 'false',
    });

    expect(await isEnabled(household.id, 'auto_generate')).toBe(false);

    await cleanup(household.id);
  });

  it('caches a read so a second call within the TTL does not hit the DB again', async () => {
    const household = await makeHousehold('Flags cache A');
    await db.insert(householdSettings).values({
      householdId: household.id,
      key: 'csv_import',
      value: 'true',
    });

    expect(await isEnabled(household.id, 'csv_import')).toBe(true);

    // Mutate the row directly (bypassing setFlag, which would evict the cache) — if
    // isEnabled were re-querying the DB, this second call would see 'false'. It
    // shouldn't, because the first call's result is still cached.
    await db
      .update(householdSettings)
      .set({ value: 'false' })
      .where(eq(householdSettings.householdId, household.id));

    expect(await isEnabled(household.id, 'csv_import')).toBe(true);

    await cleanup(household.id);
  });
});

describe('setFlag', () => {
  it('creates a row for a household that never had one (upsert insert path)', async () => {
    const household = await makeHousehold('Flags set A');

    await setFlag(household.id, 'email_reminders', true);

    const [row] = await db
      .select()
      .from(householdSettings)
      .where(eq(householdSettings.householdId, household.id));
    expect(row).toMatchObject({ key: 'email_reminders', value: 'true' });
    expect(await isEnabled(household.id, 'email_reminders')).toBe(true);

    await cleanup(household.id);
  });

  it('updates an existing row (upsert update path) and invalidates the cache', async () => {
    const household = await makeHousehold('Flags set B');
    await setFlag(household.id, 'monthly_recap', true);
    expect(await isEnabled(household.id, 'monthly_recap')).toBe(true);

    await setFlag(household.id, 'monthly_recap', false);

    const rows = await db
      .select()
      .from(householdSettings)
      .where(eq(householdSettings.householdId, household.id));
    expect(rows).toHaveLength(1);
    expect(await isEnabled(household.id, 'monthly_recap')).toBe(false);

    await cleanup(household.id);
  });
});
