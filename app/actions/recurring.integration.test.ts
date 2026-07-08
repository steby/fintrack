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

describe('createRecurringAction', () => {
  it('a member can create a Monthly item', async () => {
    const { createRecurringAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur create A');
    mockToken = member.token;

    const result = await createRecurringAction(
      undefined,
      formData({ item: 'Rent', budgetedAmount: '1200.50', frequency: 'Monthly' }),
    );

    expect(result).toEqual({ success: true });
    const [item] = await db
      .select()
      .from(recurringSchedule)
      .where(eq(recurringSchedule.householdId, member.household.id));
    expect(item).toMatchObject({
      item: 'Rent',
      budgetedAmount: '1200.50',
      frequency: 'Monthly',
      scheduleMonths: null,
    });

    await cleanup(member.household.id);
  });

  it('rejects a negative budgeted amount (adversarial)', async () => {
    const { createRecurringAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur create B');
    mockToken = member.token;

    const result = await createRecurringAction(
      undefined,
      formData({ item: 'Rent', budgetedAmount: '-100', frequency: 'Monthly' }),
    );
    expect(result).toEqual({ error: 'Enter a valid, non-negative budgeted amount.' });

    await cleanup(member.household.id);
  });

  it('rejects malformed schedule_months for a Quarterly item (adversarial: "13,0,abc")', async () => {
    const { createRecurringAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur create C');
    mockToken = member.token;

    const result = await createRecurringAction(
      undefined,
      formData({ item: 'MCST', frequency: 'Quarterly', scheduleMonths: '13,0,abc' }),
    );
    expect(result?.error).toMatch(/schedule months/i);

    await cleanup(member.household.id);
  });

  it('normalizes valid schedule_months (sorted, deduped) before storing', async () => {
    const { createRecurringAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur create D');
    mockToken = member.token;

    await createRecurringAction(
      undefined,
      formData({ item: 'MCST', frequency: 'Quarterly', scheduleMonths: '7,1,7,4' }),
    );
    const [item] = await db
      .select()
      .from(recurringSchedule)
      .where(eq(recurringSchedule.householdId, member.household.id));
    expect(item.scheduleMonths).toBe('1,4,7');

    await cleanup(member.household.id);
  });

  it('rejects a category/account belonging to a DIFFERENT household (cross-tenant probe)', async () => {
    const { createRecurringAction } = await import('./recurring');
    const memberA = await makeHouseholdWithUser('member', 'Recur create E-A');
    const memberB = await makeHouseholdWithUser('member', 'Recur create E-B');
    const [catInB] = await db
      .insert(categories)
      .values({ householdId: memberB.household.id, name: 'B Cat', direction: 'expense' })
      .returning();

    mockToken = memberA.token;
    const result = await createRecurringAction(
      undefined,
      formData({ item: 'Rent', frequency: 'Monthly', categoryId: catInB.id }),
    );
    expect(result).toEqual({ error: 'Category not found.' });

    await cleanup(memberA.household.id, memberB.household.id);
  });

  it('a viewer cannot create a recurring item', async () => {
    const { createRecurringAction } = await import('./recurring');
    const viewer = await makeHouseholdWithUser('viewer', 'Recur create F');
    mockToken = viewer.token;

    await expect(
      createRecurringAction(undefined, formData({ item: 'Rent', frequency: 'Monthly' })),
    ).rejects.toThrow('You do not have permission to perform this action.');

    await cleanup(viewer.household.id);
  });
});

describe('toggleRecurringAction', () => {
  it('flips is_active atomically', async () => {
    const { toggleRecurringAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur toggle A');
    const [item] = await db
      .insert(recurringSchedule)
      .values({
        householdId: member.household.id,
        item: 'Gym',
        frequency: 'Monthly',
        isActive: true,
      })
      .returning();

    mockToken = member.token;
    await toggleRecurringAction(undefined, formData({ id: item.id }));
    let [reloaded] = await db
      .select()
      .from(recurringSchedule)
      .where(eq(recurringSchedule.id, item.id));
    expect(reloaded.isActive).toBe(false);

    await toggleRecurringAction(undefined, formData({ id: item.id }));
    [reloaded] = await db.select().from(recurringSchedule).where(eq(recurringSchedule.id, item.id));
    expect(reloaded.isActive).toBe(true);

    await cleanup(member.household.id);
  });
});

describe('generateAction', () => {
  it('generates Monthly entries across a year boundary (Dec -> Jan)', async () => {
    const { generateAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur generate A');
    await db.insert(recurringSchedule).values({
      householdId: member.household.id,
      item: 'Salary',
      frequency: 'Monthly',
      isActive: true,
    });

    mockToken = member.token;
    const result = await generateAction(
      undefined,
      formData({ fromYear: '2026', fromMonth: '11', toYear: '2027', toMonth: '2' }),
    );

    expect(result).toEqual({ success: true, generated: 4 });
    const rows = await db
      .select({ year: monthlyEntries.year, month: monthlyEntries.month })
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, member.household.id));
    expect(rows.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 },
    ]);

    await cleanup(member.household.id);
  });

  it('only generates Quarterly items in their scheduled months', async () => {
    const { generateAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur generate B');
    await db.insert(recurringSchedule).values({
      householdId: member.household.id,
      item: 'MCST',
      frequency: 'Quarterly',
      scheduleMonths: '1,4,7,10',
      isActive: true,
    });

    mockToken = member.token;
    await generateAction(
      undefined,
      formData({ fromYear: '2026', fromMonth: '1', toYear: '2026', toMonth: '6' }),
    );
    const rows = await db
      .select({ month: monthlyEntries.month })
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, member.household.id));
    expect(rows.map((r) => r.month)).toEqual([1, 4]);

    await cleanup(member.household.id);
  });

  it('a repeat generate over an overlapping range is idempotent (ON CONFLICT DO NOTHING)', async () => {
    const { generateAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur generate C');
    await db.insert(recurringSchedule).values({
      householdId: member.household.id,
      item: 'Salary',
      frequency: 'Monthly',
      isActive: true,
    });

    mockToken = member.token;
    const first = await generateAction(
      undefined,
      formData({ fromYear: '2026', fromMonth: '1', toYear: '2026', toMonth: '3' }),
    );
    const second = await generateAction(
      undefined,
      formData({ fromYear: '2026', fromMonth: '2', toYear: '2026', toMonth: '4' }),
    );

    expect(first?.generated).toBe(3);
    expect(second?.generated).toBe(1); // only month 4 is new; 2 and 3 already exist
    const rows = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, member.household.id));
    expect(rows).toHaveLength(4);

    await cleanup(member.household.id);
  });

  it('rejects a range spanning more than the generous cap (adversarial: forged huge range)', async () => {
    const { generateAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur generate D');
    mockToken = member.token;

    const result = await generateAction(
      undefined,
      formData({ fromYear: '2000', fromMonth: '1', toYear: '2099', toMonth: '12' }),
    );
    expect(result?.error).toMatch(/at most/i);

    await cleanup(member.household.id);
  });

  it('does not generate for an inactive item', async () => {
    const { generateAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur generate E');
    await db.insert(recurringSchedule).values({
      householdId: member.household.id,
      item: 'Cancelled Sub',
      frequency: 'Monthly',
      isActive: false,
    });

    mockToken = member.token;
    const result = await generateAction(
      undefined,
      formData({ fromYear: '2026', fromMonth: '1', toYear: '2026', toMonth: '1' }),
    );
    expect(result).toEqual({ success: true, generated: 0 });

    await cleanup(member.household.id);
  });
});

describe('updateRecurringAction propagate', () => {
  it('propagates to forecast rows but skips actualized and overridden rows', async () => {
    const { updateRecurringAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur propagate A');
    const [item] = await db
      .insert(recurringSchedule)
      .values({
        householdId: member.household.id,
        item: 'Old Name',
        budgetedAmount: '100.00',
        frequency: 'Monthly',
      })
      .returning();

    const [forecastEntry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 1,
        recurringScheduleId: item.id,
        item: 'Old Name',
        budgetedAmount: '100.00',
      })
      .returning();
    const [actualizedEntry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 2,
        recurringScheduleId: item.id,
        item: 'Old Name',
        budgetedAmount: '100.00',
        actualAmount: '95.00',
      })
      .returning();
    const [overriddenEntry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 3,
        recurringScheduleId: item.id,
        item: 'Old Name',
        budgetedAmount: '100.00',
        isOverridden: true,
      })
      .returning();

    mockToken = member.token;
    const result = await updateRecurringAction(
      undefined,
      formData({
        id: item.id,
        item: 'New Name',
        budgetedAmount: '150.00',
        frequency: 'Monthly',
        propagate: 'yes',
      }),
    );
    expect(result).toEqual({ success: true });

    const [reloadedForecast] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, forecastEntry.id));
    expect(reloadedForecast).toMatchObject({ item: 'New Name', budgetedAmount: '150.00' });

    const [reloadedActualized] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, actualizedEntry.id));
    expect(reloadedActualized).toMatchObject({ item: 'Old Name', budgetedAmount: '100.00' });

    const [reloadedOverridden] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, overriddenEntry.id));
    expect(reloadedOverridden).toMatchObject({ item: 'Old Name', budgetedAmount: '100.00' });

    await cleanup(member.household.id);
  });

  it('without propagate=yes, existing monthly_entries rows are untouched', async () => {
    const { updateRecurringAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur propagate B');
    const [item] = await db
      .insert(recurringSchedule)
      .values({ householdId: member.household.id, item: 'Old Name', frequency: 'Monthly' })
      .returning();
    const [entry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 1,
        recurringScheduleId: item.id,
        item: 'Old Name',
      })
      .returning();

    mockToken = member.token;
    await updateRecurringAction(
      undefined,
      formData({ id: item.id, item: 'New Name', frequency: 'Monthly' }),
    );

    const [reloadedEntry] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entry.id));
    expect(reloadedEntry.item).toBe('Old Name');

    await cleanup(member.household.id);
  });

  it('cannot update a recurring item in a DIFFERENT household (cross-tenant probe)', async () => {
    const { updateRecurringAction } = await import('./recurring');
    const memberA = await makeHouseholdWithUser('member', 'Recur propagate C-A');
    const memberB = await makeHouseholdWithUser('member', 'Recur propagate C-B');
    const [itemInB] = await db
      .insert(recurringSchedule)
      .values({ householdId: memberB.household.id, item: 'B Item', frequency: 'Monthly' })
      .returning();

    mockToken = memberA.token;
    const result = await updateRecurringAction(
      undefined,
      formData({ id: itemInB.id, item: 'Hijacked', frequency: 'Monthly' }),
    );
    expect(result).toEqual({ error: 'Recurring item not found.' });

    await cleanup(memberA.household.id, memberB.household.id);
  });
});

describe('deleteRecurringAction', () => {
  it('removeForecast=yes deletes only forecast rows, keeping actualized rows (with the FK nulled)', async () => {
    const { deleteRecurringAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur delete A');
    const [item] = await db
      .insert(recurringSchedule)
      .values({ householdId: member.household.id, item: 'Old Sub', frequency: 'Monthly' })
      .returning();
    const [forecastEntry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 1,
        recurringScheduleId: item.id,
        item: 'Old Sub',
      })
      .returning();
    const [actualizedEntry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 2,
        recurringScheduleId: item.id,
        item: 'Old Sub',
        actualAmount: '10.00',
      })
      .returning();

    mockToken = member.token;
    const result = await deleteRecurringAction(
      undefined,
      formData({ id: item.id, removeForecast: 'yes' }),
    );
    expect(result).toEqual({ success: true });

    const [deletedItem] = await db
      .select()
      .from(recurringSchedule)
      .where(eq(recurringSchedule.id, item.id));
    expect(deletedItem).toBeUndefined();

    const [deletedForecast] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, forecastEntry.id));
    expect(deletedForecast).toBeUndefined();

    const [survivingActualized] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, actualizedEntry.id));
    expect(survivingActualized).toBeDefined();
    expect(survivingActualized.recurringScheduleId).toBeNull();

    await cleanup(member.household.id);
  });

  it('without removeForecast, monthly_entries rows survive with recurring_schedule_id nulled', async () => {
    const { deleteRecurringAction } = await import('./recurring');
    const member = await makeHouseholdWithUser('member', 'Recur delete B');
    const [item] = await db
      .insert(recurringSchedule)
      .values({ householdId: member.household.id, item: 'Old Sub', frequency: 'Monthly' })
      .returning();
    const [entry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 1,
        recurringScheduleId: item.id,
        item: 'Old Sub',
      })
      .returning();

    mockToken = member.token;
    await deleteRecurringAction(undefined, formData({ id: item.id }));

    const [surviving] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entry.id));
    expect(surviving).toBeDefined();
    expect(surviving.recurringScheduleId).toBeNull();

    await cleanup(member.household.id);
  });
});
