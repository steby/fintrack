import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { categories, recurringSchedule, monthlyEntries } from '../../lib/db/schema';
import { makeHouseholdWithUser, formData, cleanup } from './test-helpers';

let mockToken: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'session' && mockToken ? { name, value: mockToken } : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

afterEach(() => {
  mockToken = undefined;
});

describe('updateActualAction', () => {
  it('sets the actual amount and date, leaving is_overridden untouched', async () => {
    const { updateActualAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly actual A');
    const [entry] = await db
      .insert(monthlyEntries)
      .values({ householdId: member.household.id, year: 2026, month: 1, item: 'Rent' })
      .returning();

    mockToken = member.token;
    const result = await updateActualAction(
      undefined,
      formData({ id: entry.id, actualAmount: '95.50', actualDate: '2026-01-05' }),
    );

    expect(result).toEqual({ success: true });
    const [reloaded] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entry.id));
    expect(reloaded).toMatchObject({
      actualAmount: '95.50',
      actualDate: '2026-01-05',
      isOverridden: false,
    });

    await cleanup(member.household.id);
  });

  it('clears the actual amount/date back to null with empty strings', async () => {
    const { updateActualAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly actual B');
    const [entry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 1,
        item: 'Rent',
        actualAmount: '95.50',
        actualDate: '2026-01-05',
      })
      .returning();

    mockToken = member.token;
    await updateActualAction(
      undefined,
      formData({ id: entry.id, actualAmount: '', actualDate: '' }),
    );

    const [reloaded] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entry.id));
    expect(reloaded.actualAmount).toBeNull();
    expect(reloaded.actualDate).toBeNull();

    await cleanup(member.household.id);
  });

  it('rejects a negative actual amount (adversarial)', async () => {
    const { updateActualAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly actual C');
    const [entry] = await db
      .insert(monthlyEntries)
      .values({ householdId: member.household.id, year: 2026, month: 1, item: 'Rent' })
      .returning();

    mockToken = member.token;
    const result = await updateActualAction(
      undefined,
      formData({ id: entry.id, actualAmount: '-50', actualDate: '' }),
    );
    expect(result).toEqual({ error: 'Enter a valid, non-negative actual amount.' });

    await cleanup(member.household.id);
  });

  it('rejects a malformed actual date (adversarial: forged non-browser input)', async () => {
    const { updateActualAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly actual E');
    const [entry] = await db
      .insert(monthlyEntries)
      .values({ householdId: member.household.id, year: 2026, month: 1, item: 'Rent' })
      .returning();

    mockToken = member.token;
    const result = await updateActualAction(
      undefined,
      formData({ id: entry.id, actualAmount: '10.00', actualDate: 'not-a-date' }),
    );
    expect(result).toEqual({ error: 'Invalid request.' });

    await cleanup(member.household.id);
  });

  it('rejects a shape-valid but nonexistent calendar date (adversarial: Feb 30)', async () => {
    const { updateActualAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly actual F');
    const [entry] = await db
      .insert(monthlyEntries)
      .values({ householdId: member.household.id, year: 2026, month: 1, item: 'Rent' })
      .returning();

    mockToken = member.token;
    const result = await updateActualAction(
      undefined,
      formData({ id: entry.id, actualAmount: '10.00', actualDate: '2026-02-30' }),
    );
    expect(result).toEqual({ error: 'Invalid request.' });

    await cleanup(member.household.id);
  });

  it('cannot update an entry in a DIFFERENT household (cross-tenant probe)', async () => {
    const { updateActualAction } = await import('./monthly');
    const memberA = await makeHouseholdWithUser('member', 'Monthly actual D-A');
    const memberB = await makeHouseholdWithUser('member', 'Monthly actual D-B');
    const [entryInB] = await db
      .insert(monthlyEntries)
      .values({ householdId: memberB.household.id, year: 2026, month: 1, item: 'B Entry' })
      .returning();

    mockToken = memberA.token;
    const result = await updateActualAction(
      undefined,
      formData({ id: entryInB.id, actualAmount: '10.00', actualDate: '' }),
    );
    expect(result).toEqual({ error: 'Entry not found.' });

    await cleanup(memberA.household.id, memberB.household.id);
  });
});

describe('overrideBudgetAction', () => {
  it('sets the budgeted amount and marks is_overridden true', async () => {
    const { overrideBudgetAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly override A');
    const [entry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 1,
        item: 'Rent',
        budgetedAmount: '100.00',
      })
      .returning();

    mockToken = member.token;
    const result = await overrideBudgetAction(
      undefined,
      formData({ id: entry.id, budgetedAmount: '150.00' }),
    );

    expect(result).toEqual({ success: true });
    const [reloaded] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entry.id));
    expect(reloaded).toMatchObject({ budgetedAmount: '150.00', isOverridden: true });

    await cleanup(member.household.id);
  });

  it('rejects a negative budgeted amount (adversarial)', async () => {
    const { overrideBudgetAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly override B');
    const [entry] = await db
      .insert(monthlyEntries)
      .values({ householdId: member.household.id, year: 2026, month: 1, item: 'Rent' })
      .returning();

    mockToken = member.token;
    const result = await overrideBudgetAction(
      undefined,
      formData({ id: entry.id, budgetedAmount: 'NaN' }),
    );
    expect(result).toEqual({ error: 'Enter a valid, non-negative budgeted amount.' });

    await cleanup(member.household.id);
  });

  it('cannot override the budget of an entry in a DIFFERENT household (cross-tenant probe)', async () => {
    const { overrideBudgetAction } = await import('./monthly');
    const memberA = await makeHouseholdWithUser('member', 'Monthly override C-A');
    const memberB = await makeHouseholdWithUser('member', 'Monthly override C-B');
    const [entryInB] = await db
      .insert(monthlyEntries)
      .values({
        householdId: memberB.household.id,
        year: 2026,
        month: 1,
        item: 'B Entry',
        budgetedAmount: '100.00',
      })
      .returning();

    mockToken = memberA.token;
    const result = await overrideBudgetAction(
      undefined,
      formData({ id: entryInB.id, budgetedAmount: '999.00' }),
    );

    expect(result).toEqual({ error: 'Entry not found.' });
    const [unchanged] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entryInB.id));
    expect(unchanged).toMatchObject({ budgetedAmount: '100.00', isOverridden: false });

    await cleanup(memberA.household.id, memberB.household.id);
  });
});

describe('addAdhocAction', () => {
  it('creates an ad-hoc entry with no recurring_schedule_id', async () => {
    const { addAdhocAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly adhoc A');

    mockToken = member.token;
    const result = await addAdhocAction(
      undefined,
      formData({ year: '2026', month: '3', item: 'Car Repair', budgetedAmount: '250.00' }),
    );

    expect(result).toEqual({ success: true });
    const [entry] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, member.household.id));
    expect(entry).toMatchObject({
      item: 'Car Repair',
      budgetedAmount: '250.00',
      recurringScheduleId: null,
    });

    await cleanup(member.household.id);
  });

  // Phase 10: the global quick-add sheet's primary flow logs something that already
  // happened (item + actual amount + date), not just a forecast row — addAdhocSchema
  // gained an optional actualDate field for exactly this, reusing dateInputSchema's
  // existing calendar-validity check rather than a second date validator.
  it('records an actualDate when the quick-add form supplies one', async () => {
    const { addAdhocAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly adhoc quick-add A');

    mockToken = member.token;
    const result = await addAdhocAction(
      undefined,
      formData({
        year: '2026',
        month: '3',
        item: 'Lunch',
        actualAmount: '12.50',
        actualDate: '2026-03-15',
      }),
    );

    expect(result).toEqual({ success: true });
    const [entry] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, member.household.id));
    // budgetedAmount mirrors actualAmount when left blank (see addAdhocAction's own
    // comment) — a quick-logged transaction with no explicit budget shouldn't register
    // as wildly over/under budget by default.
    expect(entry).toMatchObject({
      actualAmount: '12.50',
      actualDate: '2026-03-15',
      budgetedAmount: '12.50',
    });

    await cleanup(member.household.id);
  });

  it('still defaults budgetedAmount to 0 when BOTH amount fields are left blank (unchanged behavior)', async () => {
    const { addAdhocAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly adhoc quick-add D');

    mockToken = member.token;
    await addAdhocAction(undefined, formData({ year: '2026', month: '3', item: 'Placeholder' }));

    const [entry] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, member.household.id));
    expect(entry.budgetedAmount).toBe('0.00');

    await cleanup(member.household.id);
  });

  it('leaves actualDate null when none is supplied (a plain forecast row, unchanged behavior)', async () => {
    const { addAdhocAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly adhoc quick-add B');

    mockToken = member.token;
    await addAdhocAction(
      undefined,
      formData({ year: '2026', month: '3', item: 'Car Repair', budgetedAmount: '250.00' }),
    );

    const [entry] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, member.household.id));
    expect(entry.actualDate).toBeNull();

    await cleanup(member.household.id);
  });

  it('rejects a calendar-impossible actualDate instead of silently rolling it over (adversarial)', async () => {
    const { addAdhocAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly adhoc quick-add C');

    mockToken = member.token;
    const result = await addAdhocAction(
      undefined,
      formData({ year: '2026', month: '3', item: 'Lunch', actualDate: '2026-02-30' }),
    );
    expect(result).toEqual({ error: 'Enter a valid date (YYYY-MM-DD)' });

    const rows = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, member.household.id));
    expect(rows).toHaveLength(0);

    await cleanup(member.household.id);
  });

  it('rejects a category/account/paidBy from a DIFFERENT household (cross-tenant probe)', async () => {
    const { addAdhocAction } = await import('./monthly');
    const memberA = await makeHouseholdWithUser('member', 'Monthly adhoc B-A');
    const memberB = await makeHouseholdWithUser('member', 'Monthly adhoc B-B');
    const [catInB] = await db
      .insert(categories)
      .values({ householdId: memberB.household.id, name: 'B Cat', direction: 'expense' })
      .returning();

    mockToken = memberA.token;
    const result = await addAdhocAction(
      undefined,
      formData({ year: '2026', month: '3', item: 'Car Repair', categoryId: catInB.id }),
    );
    expect(result).toEqual({ error: 'Category not found.' });

    await cleanup(memberA.household.id, memberB.household.id);
  });

  it('rejects a negative budgeted amount (adversarial)', async () => {
    const { addAdhocAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly adhoc E');
    mockToken = member.token;

    const result = await addAdhocAction(
      undefined,
      formData({ year: '2026', month: '3', item: 'Car Repair', budgetedAmount: '-1' }),
    );
    expect(result).toEqual({ error: 'Enter a valid, non-negative budgeted amount.' });

    await cleanup(member.household.id);
  });

  it('rejects a NaN actual amount (adversarial)', async () => {
    const { addAdhocAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly adhoc F');
    mockToken = member.token;

    const result = await addAdhocAction(
      undefined,
      formData({ year: '2026', month: '3', item: 'Car Repair', actualAmount: 'NaN' }),
    );
    expect(result).toEqual({ error: 'Enter a valid, non-negative actual amount.' });

    await cleanup(member.household.id);
  });

  it('rejects a blank item name', async () => {
    const { addAdhocAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly adhoc C');
    mockToken = member.token;

    const result = await addAdhocAction(
      undefined,
      formData({ year: '2026', month: '3', item: '  ' }),
    );
    expect(result).toEqual({ error: 'Item name is required' });

    await cleanup(member.household.id);
  });

  it('tags an entry with a valid household member as paidByUserId', async () => {
    const { addAdhocAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly adhoc D');

    mockToken = member.token;
    await addAdhocAction(
      undefined,
      formData({ year: '2026', month: '3', item: 'Groceries', paidByUserId: member.user.id }),
    );

    const [entry] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, member.household.id));
    expect(entry.paidByUserId).toBe(member.user.id);

    await cleanup(member.household.id);
  });

  it('rejects a paidByUserId when FEATURE_ENTRY_ATTRIBUTION is disabled (server-side, not just hidden UI)', async () => {
    vi.doMock('../../lib/env', () => ({ env: { FEATURE_ENTRY_ATTRIBUTION: false } }));
    vi.resetModules();
    try {
      const { addAdhocAction } = await import('./monthly');
      const member = await makeHouseholdWithUser('member', 'Monthly adhoc E');
      mockToken = member.token;

      const result = await addAdhocAction(
        undefined,
        formData({ year: '2026', month: '3', item: 'Groceries', paidByUserId: member.user.id }),
      );
      expect(result).toEqual({ error: 'Entry attribution is not enabled.' });

      const rows = await db
        .select()
        .from(monthlyEntries)
        .where(eq(monthlyEntries.householdId, member.household.id));
      expect(rows).toHaveLength(0);

      await cleanup(member.household.id);
    } finally {
      vi.doUnmock('../../lib/env');
      vi.resetModules();
    }
  });

  it('still allows an ad-hoc entry with no paidByUserId when FEATURE_ENTRY_ATTRIBUTION is disabled', async () => {
    vi.doMock('../../lib/env', () => ({ env: { FEATURE_ENTRY_ATTRIBUTION: false } }));
    vi.resetModules();
    try {
      const { addAdhocAction } = await import('./monthly');
      const member = await makeHouseholdWithUser('member', 'Monthly adhoc F');
      mockToken = member.token;

      const result = await addAdhocAction(
        undefined,
        formData({ year: '2026', month: '3', item: 'Groceries' }),
      );
      expect(result).toEqual({ success: true });

      await cleanup(member.household.id);
    } finally {
      vi.doUnmock('../../lib/env');
      vi.resetModules();
    }
  });
});

describe('deleteEntryAction', () => {
  it('deletes an ad-hoc entry', async () => {
    const { deleteEntryAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly delete A');
    const [entry] = await db
      .insert(monthlyEntries)
      .values({ householdId: member.household.id, year: 2026, month: 1, item: 'Ad-hoc' })
      .returning();

    mockToken = member.token;
    const result = await deleteEntryAction(undefined, formData({ id: entry.id }));

    expect(result).toEqual({ success: true });
    const [deleted] = await db.select().from(monthlyEntries).where(eq(monthlyEntries.id, entry.id));
    expect(deleted).toBeUndefined();

    await cleanup(member.household.id);
  });

  it('refuses to delete a recurring-generated entry (server-enforced, not just UI-hidden)', async () => {
    const { deleteEntryAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Monthly delete B');
    const [item] = await db
      .insert(recurringSchedule)
      .values({ householdId: member.household.id, item: 'Rent', frequency: 'Monthly' })
      .returning();
    const [entry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 1,
        item: 'Rent',
        recurringScheduleId: item.id,
      })
      .returning();

    mockToken = member.token;
    const result = await deleteEntryAction(undefined, formData({ id: entry.id }));

    expect(result).toEqual({ error: 'Entry not found.' });
    const [stillThere] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entry.id));
    expect(stillThere).toBeDefined();

    await cleanup(member.household.id);
  });

  it('a viewer cannot delete an entry', async () => {
    const { deleteEntryAction } = await import('./monthly');
    const viewer = await makeHouseholdWithUser('viewer', 'Monthly delete C');
    const [entry] = await db
      .insert(monthlyEntries)
      .values({ householdId: viewer.household.id, year: 2026, month: 1, item: 'Ad-hoc' })
      .returning();

    mockToken = viewer.token;
    await expect(deleteEntryAction(undefined, formData({ id: entry.id }))).rejects.toThrow(
      'You do not have permission to perform this action.',
    );

    await cleanup(viewer.household.id);
  });

  it('cannot delete an ad-hoc entry in a DIFFERENT household (cross-tenant probe)', async () => {
    const { deleteEntryAction } = await import('./monthly');
    const memberA = await makeHouseholdWithUser('member', 'Monthly delete D-A');
    const memberB = await makeHouseholdWithUser('member', 'Monthly delete D-B');
    const [entryInB] = await db
      .insert(monthlyEntries)
      .values({ householdId: memberB.household.id, year: 2026, month: 1, item: 'B Ad-hoc' })
      .returning();

    mockToken = memberA.token;
    const result = await deleteEntryAction(undefined, formData({ id: entryInB.id }));

    expect(result).toEqual({ error: 'Entry not found.' });
    const [stillThere] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entryInB.id));
    expect(stillThere).toBeDefined();

    await cleanup(memberA.household.id, memberB.household.id);
  });
});

describe('markPaidAction', () => {
  it('sets actualAmount to the budgeted amount and actualDate to today (UTC) for an unpaid entry', async () => {
    const { markPaidAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Mark paid A');
    const [entry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 1,
        item: 'Rent',
        budgetedAmount: '2000.00',
      })
      .returning();

    mockToken = member.token;
    const result = await markPaidAction(undefined, formData({ id: entry.id }));

    const todayIso = new Date().toISOString().slice(0, 10);
    expect(result).toEqual({
      success: true,
      alreadyPaid: false,
      previous: { actualAmount: null, actualDate: null },
    });

    const [reloaded] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entry.id));
    expect(reloaded).toMatchObject({ actualAmount: '2000.00', actualDate: todayIso });

    await cleanup(member.household.id);
  });

  it('is idempotent — double-tapping an already-paid entry is a no-op, not an error or a second write', async () => {
    const { markPaidAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Mark paid B');
    const [entry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 1,
        item: 'Rent',
        budgetedAmount: '2000.00',
      })
      .returning();

    mockToken = member.token;
    const first = await markPaidAction(undefined, formData({ id: entry.id }));
    expect(first).toMatchObject({ success: true, alreadyPaid: false });

    const second = await markPaidAction(undefined, formData({ id: entry.id }));
    expect(second).toEqual({ success: true, alreadyPaid: true });

    const [reloaded] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entry.id));
    // Still exactly what the FIRST call set — the second call must not have re-run the
    // update (e.g. overwriting a since-edited actualDate back to "today" a second time).
    expect(reloaded.actualAmount).toBe('2000.00');

    await cleanup(member.household.id);
  });

  it('carries forward a pre-existing actualDate (partial actualization) into `previous`, even though actualAmount was still null', async () => {
    const { markPaidAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Mark paid C');
    // A real, supported state (see lib/domain/entries.ts's shouldPropagate comment):
    // a date recorded with the amount still blank.
    const [entry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 1,
        item: 'Rent',
        budgetedAmount: '2000.00',
        actualDate: '2026-01-03',
      })
      .returning();

    mockToken = member.token;
    const result = await markPaidAction(undefined, formData({ id: entry.id }));

    expect(result).toEqual({
      success: true,
      alreadyPaid: false,
      previous: { actualAmount: null, actualDate: '2026-01-03' },
    });

    await cleanup(member.household.id);
  });

  it('rejects a malformed id (adversarial: forged non-UUID input)', async () => {
    const { markPaidAction } = await import('./monthly');
    const member = await makeHouseholdWithUser('member', 'Mark paid D');

    mockToken = member.token;
    const result = await markPaidAction(undefined, formData({ id: 'not-a-uuid' }));
    expect(result).toEqual({ error: 'Invalid request.' });

    await cleanup(member.household.id);
  });

  it('a viewer cannot mark an entry paid', async () => {
    const { markPaidAction } = await import('./monthly');
    const viewer = await makeHouseholdWithUser('viewer', 'Mark paid E');
    const [entry] = await db
      .insert(monthlyEntries)
      .values({ householdId: viewer.household.id, year: 2026, month: 1, item: 'Rent' })
      .returning();

    mockToken = viewer.token;
    await expect(markPaidAction(undefined, formData({ id: entry.id }))).rejects.toThrow(
      'You do not have permission to perform this action.',
    );

    await cleanup(viewer.household.id);
  });

  it('cannot mark paid an entry in a DIFFERENT household (cross-tenant probe)', async () => {
    const { markPaidAction } = await import('./monthly');
    const memberA = await makeHouseholdWithUser('member', 'Mark paid F-A');
    const memberB = await makeHouseholdWithUser('member', 'Mark paid F-B');
    const [entryInB] = await db
      .insert(monthlyEntries)
      .values({ householdId: memberB.household.id, year: 2026, month: 1, item: 'B Rent' })
      .returning();

    mockToken = memberA.token;
    const result = await markPaidAction(undefined, formData({ id: entryInB.id }));
    expect(result).toEqual({ error: 'Entry not found.' });

    const [stillUnpaid] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entryInB.id));
    expect(stillUnpaid.actualAmount).toBeNull();

    await cleanup(memberA.household.id, memberB.household.id);
  });
});

// spec.md Phase 9: lib/domain/reminders.ts (the cron email path) and
// lib/db/queries.ts's getUpcomingBillCandidates are NOT modified by this phase's
// affordability engine — lib/domain/affordability.ts's getUpcomingEntryCandidates is a
// deliberately separate, superset query/pure-fn pair (see both files' own comments).
// This test pins the OLD pair's end-to-end behavior against a real seeded fixture so a
// future edit that accidentally touches either one is caught here, not just by the
// pre-existing reminders.test.ts unit suite (which never hits a real DB row).
describe('reminders freeze (regression guard — cron email path must stay byte-identical)', () => {
  it('getUpcomingBillCandidates + selectUpcomingBills produce the same shape for a seeded fixture as before this phase', async () => {
    const { getUpcomingBillCandidates } = await import('../../lib/db/queries');
    const { selectUpcomingBills } = await import('../../lib/domain/reminders');
    const member = await makeHouseholdWithUser('member', 'Reminders freeze A');

    const today = new Date();
    const [category] = await db
      .insert(categories)
      .values({ householdId: member.household.id, name: 'Bills', direction: 'expense' })
      .returning();
    const [schedule] = await db
      .insert(recurringSchedule)
      .values({
        householdId: member.household.id,
        item: 'Rent',
        categoryId: category.id,
        budgetedAmount: '2000.00',
        frequency: 'Monthly',
        actualDateDay: today.getUTCDate(), // due today -> inside the default 3-day window
      })
      .returning();
    const [entry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: today.getUTCFullYear(),
        month: today.getUTCMonth() + 1,
        recurringScheduleId: schedule.id,
        item: 'Rent',
        categoryId: category.id,
        budgetedAmount: '2000.00',
      })
      .returning();

    const candidates = await getUpcomingBillCandidates(member.household.id, [
      { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 },
    ]);
    const bills = selectUpcomingBills(candidates, today);

    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({
      id: entry.id,
      item: 'Rent',
      daysUntilDue: 0,
      budgetedAmount: '2000.00',
      dueDate: today.toISOString().slice(0, 10),
    });

    await cleanup(member.household.id);
  });
});
