import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { households, householdSettings } from './db/schema';
import { isEnabled, setFlag, getEnabledHouseholdIds } from './flags';

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

describe('getEnabledHouseholdIds', () => {
  it('returns an empty set for an empty input array without querying the DB', async () => {
    // No household to clean up — this only matters if it doesn't throw on an empty
    // IN (...) clause, which drizzle's inArray would otherwise generate.
    expect(await getEnabledHouseholdIds([], 'auto_generate')).toEqual(new Set());
  });

  it('falls back to the documented default for households with no explicit row, matching isEnabled', async () => {
    const onByDefault = await makeHousehold('Batch flags default A (on)');
    const offByDefault = await makeHousehold('Batch flags default B (off)');

    const enabled = await getEnabledHouseholdIds(
      [onByDefault.id, offByDefault.id],
      'auto_generate', // defaults true
    );
    expect(enabled.has(onByDefault.id)).toBe(true);

    const enabledCsv = await getEnabledHouseholdIds(
      [onByDefault.id, offByDefault.id],
      'csv_import', // defaults false
    );
    expect(enabledCsv.size).toBe(0);

    await cleanup(onByDefault.id);
    await cleanup(offByDefault.id);
  });

  it('reads explicit true/false overrides, and correctly separates enabled from disabled within one batch', async () => {
    const enabledHousehold = await makeHousehold('Batch flags explicit A');
    const disabledHousehold = await makeHousehold('Batch flags explicit B');
    await setFlag(enabledHousehold.id, 'email_reminders', true);
    await setFlag(disabledHousehold.id, 'email_reminders', false);

    const enabled = await getEnabledHouseholdIds(
      [enabledHousehold.id, disabledHousehold.id],
      'email_reminders',
    );
    expect(enabled.has(enabledHousehold.id)).toBe(true);
    expect(enabled.has(disabledHousehold.id)).toBe(false);

    await cleanup(enabledHousehold.id);
    await cleanup(disabledHousehold.id);
  });

  it('ignores a household not included in the requested id list, even if it has the flag on', async () => {
    const requested = await makeHousehold('Batch flags scoping A');
    const notRequested = await makeHousehold('Batch flags scoping B');
    await setFlag(notRequested.id, 'monthly_recap', true);

    const enabled = await getEnabledHouseholdIds([requested.id], 'monthly_recap');
    expect(enabled.has(notRequested.id)).toBe(false);

    await cleanup(requested.id);
    await cleanup(notRequested.id);
  });

  it('matches isEnabled() called individually, for the same households/flag', async () => {
    const a = await makeHousehold('Batch flags parity A');
    const b = await makeHousehold('Batch flags parity B');
    const c = await makeHousehold('Batch flags parity C');
    await setFlag(a.id, 'csv_import', true);
    await setFlag(b.id, 'csv_import', false);
    // c: left at its default (false)

    const individually = new Set<string>();
    for (const h of [a, b, c]) {
      if (await isEnabled(h.id, 'csv_import')) individually.add(h.id);
    }
    const batched = await getEnabledHouseholdIds([a.id, b.id, c.id], 'csv_import');

    expect(batched).toEqual(individually);

    await cleanup(a.id);
    await cleanup(b.id);
    await cleanup(c.id);
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
