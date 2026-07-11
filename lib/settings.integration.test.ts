import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { households, householdSettings } from './db/schema';
import { getSetting, setSetting } from './settings';

async function makeHousehold(label: string) {
  const [household] = await db.insert(households).values({ name: label }).returning();
  return household;
}

async function cleanup(householdId: string) {
  await db.delete(households).where(eq(households.id, householdId));
}

describe('getSetting', () => {
  it('returns null when no row exists', async () => {
    const household = await makeHousehold('Settings default A');
    try {
      expect(await getSetting(household.id, 'affordability_horizon')).toBeNull();
    } finally {
      await cleanup(household.id);
    }
  });

  it('reads back an explicitly stored value', async () => {
    const household = await makeHousehold('Settings explicit A');
    try {
      await db.insert(householdSettings).values({
        householdId: household.id,
        key: 'affordability_horizon',
        value: '14',
      });
      expect(await getSetting(household.id, 'affordability_horizon')).toBe('14');
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns a value from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Settings scoping A');
    const householdB = await makeHousehold('Settings scoping B');
    try {
      await db.insert(householdSettings).values({
        householdId: householdB.id,
        key: 'affordability_horizon',
        value: '30',
      });
      expect(await getSetting(householdA.id, 'affordability_horizon')).toBeNull();
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });

  it('reads a key that happens to collide with a lib/flags.ts KillSwitchKey without interfering with it (same table, disjoint keys)', async () => {
    const household = await makeHousehold('Settings coexist A');
    try {
      await db.insert(householdSettings).values([
        { householdId: household.id, key: 'auto_generate', value: 'false' },
        { householdId: household.id, key: 'affordability_horizon', value: '7' },
      ]);
      expect(await getSetting(household.id, 'affordability_horizon')).toBe('7');
      expect(await getSetting(household.id, 'auto_generate')).toBe('false');
    } finally {
      await cleanup(household.id);
    }
  });
});

describe('setSetting', () => {
  it('creates a row for a household that never had one (upsert insert path)', async () => {
    const household = await makeHousehold('Settings set A');
    try {
      await setSetting(household.id, 'affordability_horizon', 'month');

      const [row] = await db
        .select()
        .from(householdSettings)
        .where(eq(householdSettings.householdId, household.id));
      expect(row).toMatchObject({ key: 'affordability_horizon', value: 'month' });
    } finally {
      await cleanup(household.id);
    }
  });

  it('updates an existing row in place (upsert update path), never creating a duplicate', async () => {
    const household = await makeHousehold('Settings set B');
    try {
      await setSetting(household.id, 'affordability_horizon', '7');
      await setSetting(household.id, 'affordability_horizon', '30');

      const rows = await db
        .select()
        .from(householdSettings)
        .where(eq(householdSettings.householdId, household.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('30');
      expect(await getSetting(household.id, 'affordability_horizon')).toBe('30');
    } finally {
      await cleanup(household.id);
    }
  });
});
