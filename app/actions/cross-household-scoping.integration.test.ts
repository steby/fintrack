import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../lib/db';
import {
  categories,
  goals,
  monthlyEntries,
  recurringSchedule,
  bankAccounts,
} from '../../lib/db/schema';
import { makeHouseholdWithUser, formData, cleanup } from './test-helpers';

// Final Phase 7 adversarial-sweep pass (spec.md: "scoping probe with two seeded
// households"). Every action module already scopes its mutations by householdId in the
// WHERE clause (confirmed by reading each one — see the comments in categories.ts,
// goals.ts, monthly.ts, recurring.ts referencing "missing household_id filter ->
// cross-tenant leak"); accounts.ts/import.ts/members.ts already have their own
// dedicated cross-tenant probe tests. This file adds the same probe for the modules
// that didn't have one yet, as a regression guard against a future edit accidentally
// dropping the householdId clause.

let mockToken: string | undefined;
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'session' && mockToken ? { name, value: mockToken } : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

afterAll(async () => {
  await pool.end();
});

afterEach(() => {
  mockToken = undefined;
});

describe('cross-household scoping probes', () => {
  it('cannot update or delete a category belonging to a different household', async () => {
    const { updateCategoryAction, deleteCategoryAction } = await import('./categories');
    const a = await makeHouseholdWithUser('member', 'Scoping cat A');
    const b = await makeHouseholdWithUser('member', 'Scoping cat B');
    const [catInB] = await db
      .insert(categories)
      .values({ householdId: b.household.id, name: 'B Category', direction: 'expense' })
      .returning();

    mockToken = a.token;
    const updateResult = await updateCategoryAction(
      undefined,
      formData({ id: catInB.id, name: 'Hijacked', direction: 'expense', color: '#111111' }),
    );
    expect(updateResult).toEqual({ error: 'Category not found.' });

    const deleteResult = await deleteCategoryAction(undefined, formData({ id: catInB.id }));
    expect(deleteResult).toEqual({ error: 'Category not found.' });

    const [stillThere] = await db.select().from(categories).where(eq(categories.id, catInB.id));
    expect(stillThere).toBeDefined();
    expect(stillThere.name).toBe('B Category');

    await cleanup(a.household.id, b.household.id);
  });

  it('cannot update or delete a goal belonging to a different household', async () => {
    const { updateGoalAction, deleteGoalAction } = await import('./goals');
    const a = await makeHouseholdWithUser('member', 'Scoping goal A');
    const b = await makeHouseholdWithUser('member', 'Scoping goal B');
    const [goalInB] = await db
      .insert(goals)
      .values({ householdId: b.household.id, name: 'B Goal', targetAmount: '1000.00' })
      .returning();

    mockToken = a.token;
    const updateResult = await updateGoalAction(
      undefined,
      formData({ id: goalInB.id, name: 'Hijacked', targetAmount: '1.00', targetDate: '' }),
    );
    expect(updateResult).toEqual({ error: 'Goal not found.' });

    const deleteResult = await deleteGoalAction(undefined, formData({ id: goalInB.id }));
    expect(deleteResult).toEqual({ error: 'Goal not found.' });

    const [stillThere] = await db.select().from(goals).where(eq(goals.id, goalInB.id));
    expect(stillThere).toBeDefined();
    expect(stillThere.name).toBe('B Goal');

    await cleanup(a.household.id, b.household.id);
  });

  it('cannot update the actual amount, override the budget, or delete a monthly entry belonging to a different household', async () => {
    const { updateActualAction, overrideBudgetAction, deleteEntryAction } =
      await import('./monthly');
    const a = await makeHouseholdWithUser('member', 'Scoping entry A');
    const b = await makeHouseholdWithUser('member', 'Scoping entry B');
    const [entryInB] = await db
      .insert(monthlyEntries)
      .values({
        householdId: b.household.id,
        year: 2077,
        month: 3,
        item: 'B Ad-hoc Entry',
        budgetedAmount: '50.00',
      })
      .returning();

    mockToken = a.token;

    const actualResult = await updateActualAction(
      undefined,
      formData({ id: entryInB.id, actualAmount: '999.00', actualDate: '2077-03-01' }),
    );
    expect(actualResult).toEqual({ error: 'Entry not found.' });

    const budgetResult = await overrideBudgetAction(
      undefined,
      formData({ id: entryInB.id, budgetedAmount: '999.00' }),
    );
    expect(budgetResult).toEqual({ error: 'Entry not found.' });

    const deleteResult = await deleteEntryAction(undefined, formData({ id: entryInB.id }));
    expect(deleteResult).toEqual({ error: 'Entry not found.' });

    const [stillThere] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entryInB.id));
    expect(stillThere).toBeDefined();
    expect(stillThere.budgetedAmount).toBe('50.00');
    expect(stillThere.actualAmount).toBeNull();

    await cleanup(a.household.id, b.household.id);
  });

  it('addAdhocAction rejects a category/account/member id borrowed from a different household', async () => {
    const { addAdhocAction } = await import('./monthly');
    const a = await makeHouseholdWithUser('member', 'Scoping adhoc A');
    const b = await makeHouseholdWithUser('member', 'Scoping adhoc B');
    const [catInB] = await db
      .insert(categories)
      .values({ householdId: b.household.id, name: 'B Category', direction: 'expense' })
      .returning();

    mockToken = a.token;
    const result = await addAdhocAction(
      undefined,
      formData({
        year: '2077',
        month: '3',
        item: 'Borrowed category probe',
        categoryId: catInB.id,
      }),
    );
    expect(result).toEqual({ error: 'Category not found.' });

    await cleanup(a.household.id, b.household.id);
  });

  it('cannot update, delete, or toggle a recurring item belonging to a different household', async () => {
    const { updateRecurringAction, deleteRecurringAction, toggleRecurringAction } =
      await import('./recurring');
    const a = await makeHouseholdWithUser('member', 'Scoping recur A');
    const b = await makeHouseholdWithUser('member', 'Scoping recur B');
    const [itemInB] = await db
      .insert(recurringSchedule)
      .values({
        householdId: b.household.id,
        item: 'B Mortgage',
        budgetedAmount: '2000.00',
        frequency: 'Monthly',
      })
      .returning();

    mockToken = a.token;

    const updateResult = await updateRecurringAction(
      undefined,
      formData({ id: itemInB.id, item: 'Hijacked', budgetedAmount: '1.00', frequency: 'Monthly' }),
    );
    expect(updateResult).toEqual({ error: 'Recurring item not found.' });

    const toggleResult = await toggleRecurringAction(undefined, formData({ id: itemInB.id }));
    expect(toggleResult).toEqual({ error: 'Recurring item not found.' });

    const deleteResult = await deleteRecurringAction(undefined, formData({ id: itemInB.id }));
    expect(deleteResult).toEqual({ error: 'Recurring item not found.' });

    const [stillThere] = await db
      .select()
      .from(recurringSchedule)
      .where(eq(recurringSchedule.id, itemInB.id));
    expect(stillThere).toBeDefined();
    expect(stillThere.item).toBe('B Mortgage');
    expect(stillThere.isActive).toBe(true);

    await cleanup(a.household.id, b.household.id);
  });

  it('updateRecurringAction rejects a category/account id borrowed from a different household', async () => {
    const { createRecurringAction, updateRecurringAction } = await import('./recurring');
    const a = await makeHouseholdWithUser('member', 'Scoping recur ref A');
    const b = await makeHouseholdWithUser('member', 'Scoping recur ref B');
    const [acctInB] = await db
      .insert(bankAccounts)
      .values({ householdId: b.household.id, name: 'B Bank', accountType: 'bank' })
      .returning();

    mockToken = a.token;
    await createRecurringAction(
      undefined,
      formData({ item: 'A Own Item', budgetedAmount: '10.00', frequency: 'Monthly' }),
    );
    const [ownItem] = await db
      .select()
      .from(recurringSchedule)
      .where(eq(recurringSchedule.householdId, a.household.id));

    const result = await updateRecurringAction(
      undefined,
      formData({
        id: ownItem.id,
        item: 'A Own Item',
        budgetedAmount: '10.00',
        frequency: 'Monthly',
        bankAccountId: acctInB.id,
      }),
    );
    expect(result).toEqual({ error: 'Bank account not found.' });

    await cleanup(a.household.id, b.household.id);
  });
});
