import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from './index';
import { households, categories, bankAccounts, monthlyEntries } from './schema';
import { getDashboardRows } from './queries';

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

describe('getDashboardRows', () => {
  it('returns an empty array for a household/year with no entries', async () => {
    const household = await makeHousehold('Dashboard query A');
    try {
      const rows = await getDashboardRows(household.id, 2026);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(household.id);
    }
  });

  it('joins category direction/name/color and bank account name, converting amounts to cents', async () => {
    const household = await makeHousehold('Dashboard query B');
    try {
      const [category] = await db
        .insert(categories)
        .values({
          householdId: household.id,
          name: 'Salary',
          direction: 'income',
          color: '#111111',
        })
        .returning();
      const [account] = await db
        .insert(bankAccounts)
        .values({ householdId: household.id, name: 'Checking' })
        .returning();
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 3,
        item: 'Salary',
        categoryId: category.id,
        bankAccountId: account.id,
        budgetedAmount: '5000.00',
        actualAmount: '5200.50',
      });

      const rows = await getDashboardRows(household.id, 2026);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        month: 3,
        budgetedCents: 500000,
        actualCents: 520050,
        direction: 'income',
        categoryName: 'Salary',
        categoryColor: '#111111',
        bankAccountName: 'Checking',
      });
    } finally {
      await cleanup(household.id);
    }
  });

  it('leaves actualCents null when no actual has been entered yet', async () => {
    const household = await makeHousehold('Dashboard query C');
    try {
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 1,
        item: 'Forecast only',
        budgetedAmount: '100.00',
      });

      const rows = await getDashboardRows(household.id, 2026);
      expect(rows[0]).toMatchObject({
        budgetedCents: 10000,
        actualCents: null,
        direction: null,
        categoryName: null,
        bankAccountName: null,
      });
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns rows from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Dashboard query D-A');
    const householdB = await makeHousehold('Dashboard query D-B');
    try {
      await db.insert(monthlyEntries).values({
        householdId: householdB.id,
        year: 2026,
        month: 1,
        item: 'Other household entry',
        budgetedAmount: '1.00',
      });

      const rows = await getDashboardRows(householdA.id, 2026);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });

  it('scopes by year — entries from a different year are excluded', async () => {
    const household = await makeHousehold('Dashboard query E');
    try {
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2025,
        month: 12,
        item: 'Last year',
        budgetedAmount: '1.00',
      });

      const rows = await getDashboardRows(household.id, 2026);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(household.id);
    }
  });
});
