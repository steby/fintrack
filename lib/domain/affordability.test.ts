import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { centsToAmount } from '../money';
import {
  parseHorizon,
  resolveHorizonDays,
  selectUpcomingItems,
  computeSafeToSpend,
  computeBudgetRemaining,
  buildRunway,
  type UpcomingEntryCandidate,
  type UpcomingItem,
} from './affordability';

function candidate(overrides: Partial<UpcomingEntryCandidate> = {}): UpcomingEntryCandidate {
  return {
    id: 'entry-1',
    item: 'Rent',
    year: 2026,
    month: 7,
    actualDateDay: 12,
    actualAmount: null,
    budgetedAmount: '2000.00',
    direction: 'expense',
    categoryName: 'Housing',
    categoryColor: '#111111',
    ...overrides,
  };
}

function upcomingItem(overrides: Partial<UpcomingItem> = {}): UpcomingItem {
  return {
    entryId: 'entry-1',
    item: 'Rent',
    dueDate: '2026-07-12',
    daysUntilDue: 3,
    amountCents: 200000,
    direction: 'expense',
    scheduled: true,
    overdue: false,
    categoryName: 'Housing',
    categoryColor: '#111111',
    ...overrides,
  };
}

describe('parseHorizon', () => {
  it.each(['7', '14', '30'] as const)('accepts %j', (raw) => {
    expect(parseHorizon(raw)).toBe(Number(raw));
  });

  it.each(['abc', '', '9999', null, undefined, '07', '-7', '30.5'])(
    'falls back to "month" for %j',
    (raw) => {
      expect(parseHorizon(raw)).toBe('month');
    },
  );
});

describe('resolveHorizonDays', () => {
  it.each([7, 14, 30] as const)('returns the literal for a fixed %d-day horizon', (h) => {
    expect(resolveHorizonDays(h, new Date('2026-07-15T00:00:00Z'))).toBe(h);
  });

  it('"month" on the 1st of a 31-day month reaches all the way to the 31st', () => {
    expect(resolveHorizonDays('month', new Date('2026-07-01T00:00:00Z'))).toBe(30);
  });

  it('"month" on the last day of a month is 0 (window is just today)', () => {
    expect(resolveHorizonDays('month', new Date('2026-07-31T00:00:00Z'))).toBe(0);
  });

  it('"month" respects a 28-day February', () => {
    expect(resolveHorizonDays('month', new Date('2026-02-01T00:00:00Z'))).toBe(27);
  });

  it('"month" respects a 29-day (leap) February', () => {
    expect(resolveHorizonDays('month', new Date('2024-02-01T00:00:00Z'))).toBe(28);
  });
});

describe('selectUpcomingItems', () => {
  const today = new Date('2026-07-09T12:00:00Z');

  it('returns an empty array for no candidates', () => {
    expect(selectUpcomingItems([], today, 30)).toEqual([]);
  });

  it('skips a paid item (actualAmount set)', () => {
    const result = selectUpcomingItems(
      [candidate({ actualDateDay: 12, actualAmount: '2000.00' })],
      today,
      30,
    );
    expect(result).toEqual([]);
  });

  it('skips an uncategorized item (direction null)', () => {
    const result = selectUpcomingItems([candidate({ direction: null })], today, 30);
    expect(result).toEqual([]);
  });

  it('includes an unpaid expense due within the horizon', () => {
    const result = selectUpcomingItems([candidate({ actualDateDay: 12 })], today, 30);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      entryId: 'entry-1',
      dueDate: '2026-07-12',
      daysUntilDue: 3,
      scheduled: true,
      overdue: false,
    });
  });

  it('excludes an item due beyond the horizon', () => {
    const result = selectUpcomingItems([candidate({ actualDateDay: 12 })], today, 2);
    expect(result).toEqual([]);
  });

  it('clamps a day-31 due day in February (non-leap) to the 28th', () => {
    const febToday = new Date('2027-02-01T00:00:00Z');
    const result = selectUpcomingItems(
      [candidate({ year: 2027, month: 2, actualDateDay: 31 })],
      febToday,
      30,
    );
    expect(result).toHaveLength(1);
    expect(result[0].dueDate).toBe('2027-02-28');
  });

  it('an unscheduled entry (no actual_date_day) is due at the clamped end of its month', () => {
    const result = selectUpcomingItems(
      [candidate({ actualDateDay: null, year: 2026, month: 4 })],
      new Date('2026-04-25T00:00:00Z'),
      30,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ dueDate: '2026-04-30', scheduled: false });
  });

  it('a Dec-today candidate in the next-month (Jan) bucket spills across the year boundary', () => {
    const decToday = new Date('2026-12-28T00:00:00Z');
    const result = selectUpcomingItems(
      [candidate({ year: 2027, month: 1, actualDateDay: 3 })],
      decToday,
      30,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ dueDate: '2027-01-03', daysUntilDue: 6 });
  });

  it('a current-month unpaid expense whose due day already passed is "overdue" and included regardless of horizon', () => {
    const result = selectUpcomingItems([candidate({ actualDateDay: 1 })], today, 0);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ daysUntilDue: -8, overdue: true });
  });

  it('a next-month candidate is never "overdue" even if horizon is 0 and its due date is out of window', () => {
    const result = selectUpcomingItems(
      [candidate({ year: 2026, month: 8, actualDateDay: 1 })],
      today,
      0,
    );
    expect(result).toEqual([]);
  });

  it('sorts by due date, then item name', () => {
    const result = selectUpcomingItems(
      [
        candidate({ id: 'a', item: 'Zoo membership', actualDateDay: 10 }),
        candidate({ id: 'b', item: 'Aardvark food', actualDateDay: 10 }),
        candidate({ id: 'c', item: 'Rent', actualDateDay: 9 }),
      ],
      today,
      30,
    );
    expect(result.map((r) => r.entryId)).toEqual(['c', 'b', 'a']);
  });

  it('income items are included and marked with direction income (not subtracted anywhere in this function)', () => {
    const result = selectUpcomingItems(
      [candidate({ direction: 'income', actualDateDay: 15, budgetedAmount: '5000.00' })],
      today,
      30,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ direction: 'income', amountCents: 500000 });
  });
});

describe('computeSafeToSpend', () => {
  it('subtracts upcoming and overdue expenses; leaves income out of the headline number', () => {
    const items: UpcomingItem[] = [
      upcomingItem({ entryId: 'a', direction: 'expense', amountCents: 10000, overdue: false }),
      upcomingItem({ entryId: 'b', direction: 'expense', amountCents: 5000, overdue: true }),
      upcomingItem({ entryId: 'c', direction: 'income', amountCents: 300000, overdue: false }),
    ];
    const result = computeSafeToSpend(200000, items);
    expect(result).toEqual({
      currentCashCents: 200000,
      upcomingExpenseCents: 10000,
      overdueExpenseCents: 5000,
      expectedIncomeCents: 300000,
      safeToSpendCents: 185000, // 200000 - 10000 - 5000, income NOT added back
    });
  });

  it('can go negative — a warning state, not an error', () => {
    const items = [upcomingItem({ direction: 'expense', amountCents: 500000 })];
    const result = computeSafeToSpend(100000, items);
    expect(result.safeToSpendCents).toBe(-400000);
  });

  it('is a no-op for an empty item list', () => {
    const result = computeSafeToSpend(50000, []);
    expect(result.safeToSpendCents).toBe(50000);
  });
});

describe('computeBudgetRemaining', () => {
  it('remaining = budgeted - actual-spent-so-far (not best-estimate)', () => {
    const result = computeBudgetRemaining([
      { direction: 'expense', budgetedCents: 100000, actualCents: 40000 },
      { direction: 'expense', budgetedCents: 50000, actualCents: null }, // not yet spent
      { direction: 'income', budgetedCents: 999999, actualCents: 999999 }, // ignored
    ]);
    expect(result).toEqual({
      budgetedExpenseCents: 150000,
      spentExpenseCents: 40000,
      remainingCents: 110000,
      pctSpent: (40000 / 150000) * 100,
    });
  });

  it('pctSpent is 0, not NaN, when nothing is budgeted', () => {
    const result = computeBudgetRemaining([]);
    expect(result).toEqual({
      budgetedExpenseCents: 0,
      spentExpenseCents: 0,
      remainingCents: 0,
      pctSpent: 0,
    });
  });
});

describe('buildRunway', () => {
  const today = new Date('2026-07-09T00:00:00Z');

  it('produces horizonDays + 1 points, applying signed deltas on their due day', () => {
    const items: UpcomingItem[] = [
      upcomingItem({ direction: 'expense', amountCents: 10000, daysUntilDue: 2, overdue: false }),
      upcomingItem({ direction: 'income', amountCents: 50000, daysUntilDue: 5, overdue: false }),
    ];
    const points = buildRunway(100000, items, today, 5);
    expect(points).toHaveLength(6);
    expect(points[0]).toEqual({ date: '2026-07-09', projectedCashCents: 100000 });
    expect(points[2].projectedCashCents).toBe(90000); // day-2 expense applied
    expect(points[5].projectedCashCents).toBe(140000); // + day-5 income
  });

  it('applies overdue items on day 0 regardless of their real (negative) daysUntilDue', () => {
    const items: UpcomingItem[] = [
      upcomingItem({ direction: 'expense', amountCents: 20000, daysUntilDue: -3, overdue: true }),
    ];
    const points = buildRunway(100000, items, today, 5);
    expect(points[0].projectedCashCents).toBe(80000);
    expect(points[5].projectedCashCents).toBe(80000); // stays applied through the end
  });

  it('is a flat line at currentCashCents for an empty item list', () => {
    const points = buildRunway(75000, [], today, 3);
    expect(points).toHaveLength(4);
    expect(points.every((p) => p.projectedCashCents === 75000)).toBe(true);
  });
});

// Property tests (fast-check) — same treatment as lib/money.test.ts and
// lib/domain/net-worth.test.ts for this money-math module (user decision, plan WISDOM
// section: "Money-math testing: property tests (fast-check) for the new affordability
// module — same treatment existing money math gets").

const centsArb = fc.integer({ min: 0, max: 5_000_000 });
const idArb = fc.uuid();

const upcomingItemArb = fc.record({
  entryId: idArb,
  item: fc.string({ minLength: 1, maxLength: 20 }),
  dueDate: fc.constant('2026-07-15'),
  daysUntilDue: fc.integer({ min: -100, max: 200 }),
  amountCents: centsArb,
  direction: fc.constantFrom<'income' | 'expense'>('income', 'expense'),
  scheduled: fc.boolean(),
  overdue: fc.boolean(),
  categoryName: fc.constant(null),
  categoryColor: fc.constant(null),
});

describe('property: computeSafeToSpend conservation', () => {
  it('cash minus safeToSpend always equals total expense subtracted (upcoming + overdue), for any item mix', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 10_000_000 }),
        fc.array(upcomingItemArb, { maxLength: 30 }),
        (cash, items) => {
          const result = computeSafeToSpend(cash, items);
          const totalExpense = items
            .filter((i) => i.direction === 'expense')
            .reduce((sum, i) => sum + i.amountCents, 0);
          expect(cash - result.safeToSpendCents).toBe(totalExpense);
          expect(result.upcomingExpenseCents + result.overdueExpenseCents).toBe(totalExpense);
          expect(Number.isInteger(result.safeToSpendCents)).toBe(true);
        },
      ),
    );
  });
});

describe('property: computeBudgetRemaining identity', () => {
  it('remaining + spent === budgeted for any entry mix; pctSpent is always finite', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            direction: fc.constantFrom<'income' | 'expense' | null>('income', 'expense', null),
            budgetedCents: centsArb,
            actualCents: fc.option(centsArb, { nil: null }),
          }),
          { maxLength: 30 },
        ),
        (entries) => {
          const result = computeBudgetRemaining(entries);
          expect(result.remainingCents + result.spentExpenseCents).toBe(
            result.budgetedExpenseCents,
          );
          expect(Number.isFinite(result.pctSpent)).toBe(true);
          expect(Number.isNaN(result.pctSpent)).toBe(false);
        },
      ),
    );
  });
});

describe('property: buildRunway conservation and shape', () => {
  it('always returns horizonDays + 1 finite points, and the last point conserves total signed cash flow', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 10_000_000 }),
        fc.integer({ min: 0, max: 60 }),
        fc.array(upcomingItemArb, { maxLength: 30 }),
        (cash, horizonDays, items) => {
          const points = buildRunway(cash, items, new Date('2026-07-09T00:00:00Z'), horizonDays);
          expect(points).toHaveLength(horizonDays + 1);
          expect(points.every((p) => Number.isFinite(p.projectedCashCents))).toBe(true);

          const signedSum = items.reduce(
            (sum, i) => sum + (i.direction === 'income' ? i.amountCents : -i.amountCents),
            0,
          );
          expect(points[points.length - 1].projectedCashCents).toBe(cash + signedSum);
        },
      ),
    );
  });
});

const candidateArb = fc.record({
  item: fc.string({ minLength: 1, maxLength: 20 }),
  year: fc.integer({ min: 2020, max: 2030 }),
  month: fc.integer({ min: 1, max: 12 }),
  actualDateDay: fc.option(fc.integer({ min: 1, max: 31 }), { nil: null }),
  actualAmount: fc.option(centsArb.map(centsToAmount), { nil: null }),
  budgetedAmount: centsArb.map(centsToAmount),
  direction: fc.constantFrom<'income' | 'expense' | null>('income', 'expense', null),
  categoryName: fc.constant(null),
  categoryColor: fc.constant(null),
});

describe('property: selectUpcomingItems never selects a paid or uncategorized candidate', () => {
  it('holds for arbitrary candidate arrays, any today, any horizon', () => {
    fc.assert(
      fc.property(
        fc.array(candidateArb, { maxLength: 20 }),
        fc.integer({ min: 2024, max: 2028 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 45 }),
        (rawCandidates, year, month, day, horizonDays) => {
          const candidates: UpcomingEntryCandidate[] = rawCandidates.map((c, i) => ({
            ...c,
            id: `c-${i}`,
          }));
          const today = new Date(Date.UTC(year, month - 1, day));
          const result = selectUpcomingItems(candidates, today, horizonDays);

          const paidIds = new Set(
            candidates.filter((c) => c.actualAmount !== null).map((c) => c.id),
          );
          const uncategorizedIds = new Set(
            candidates.filter((c) => c.direction === null).map((c) => c.id),
          );

          for (const item of result) {
            expect(paidIds.has(item.entryId)).toBe(false);
            expect(uncategorizedIds.has(item.entryId)).toBe(false);
            expect(Number.isInteger(item.amountCents)).toBe(true);
          }
        },
      ),
    );
  });
});
