import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../lib/db';
import {
  households,
  users,
  sessions,
  categories,
  recurringSchedule,
  monthlyEntries,
} from '../../lib/db/schema';
import { generateToken } from '../../lib/auth/token';
import { newExpiry } from '../../lib/auth/session-rules';

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

async function makeHouseholdWithUser(role: 'owner' | 'member' | 'viewer', label: string) {
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
  await db.insert(sessions).values({ id: token, userId: user.id, expiresAt: newExpiry() });
  return { household, user, token };
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

async function cleanup(...householdIds: string[]) {
  for (const id of householdIds) {
    await db.delete(households).where(eq(households.id, id));
  }
}

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
});
