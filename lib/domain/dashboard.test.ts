import { describe, expect, it } from 'vitest';
import {
  buildMonthlySeries,
  sumMonthlySeries,
  buildCategoryBreakdown,
  buildCumulativeSavings,
  buildFixedVsVariable,
  buildBankSummary,
  buildYoyDelta,
  sumIncomeExpense,
  bestEstimateCents,
  actualOnlyCents,
  type DashboardEntryRow,
} from './dashboard';

function row(overrides: Partial<DashboardEntryRow>): DashboardEntryRow {
  return {
    month: 1,
    budgetedCents: 10000,
    actualCents: null,
    direction: 'expense',
    categoryId: 'cat-1',
    categoryName: 'Housing',
    categoryColor: '#F59E0B',
    recurringScheduleId: null,
    bankAccountId: null,
    bankAccountName: null,
    ...overrides,
  };
}

describe('bestEstimateCents', () => {
  it('prefers the actual when set', () => {
    expect(bestEstimateCents({ budgetedCents: 1000, actualCents: 900 })).toBe(900);
  });

  it('falls back to budgeted when actual is null', () => {
    expect(bestEstimateCents({ budgetedCents: 1000, actualCents: null })).toBe(1000);
  });
});

describe('actualOnlyCents', () => {
  it('returns the actual amount when set', () => {
    expect(actualOnlyCents({ actualCents: 900 })).toBe(900);
  });

  it('returns null (NOT the budgeted amount) for a still-unpaid entry — the opposite fallback rule from bestEstimateCents', () => {
    expect(actualOnlyCents({ actualCents: null })).toBeNull();
  });
});

describe('buildMonthlySeries', () => {
  it('always returns 12 points, even for a completely empty year', () => {
    const series = buildMonthlySeries([]);
    expect(series).toHaveLength(12);
    expect(series.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(series.every((m) => m.netBudgetedCents === 0 && m.netActualCents === 0)).toBe(true);
    expect(series.every((m) => m.hasActuals === false)).toBe(true);
  });

  it('splits budgeted/actual by direction, per month', () => {
    const series = buildMonthlySeries([
      row({ month: 1, direction: 'income', budgetedCents: 500000, actualCents: 520000 }),
      row({ month: 1, direction: 'expense', budgetedCents: 300000, actualCents: 280000 }),
      row({ month: 2, direction: 'expense', budgetedCents: 10000, actualCents: null }),
    ]);
    expect(series[0]).toMatchObject({
      budgetedIncomeCents: 500000,
      actualIncomeCents: 520000,
      budgetedExpenseCents: 300000,
      actualExpenseCents: 280000,
      netBudgetedCents: 200000,
      netActualCents: 240000,
      hasActuals: true,
    });
    expect(series[1]).toMatchObject({ budgetedExpenseCents: 10000, hasActuals: false });
  });

  it('excludes uncategorized (null-direction) rows from every sum', () => {
    const series = buildMonthlySeries([row({ month: 1, direction: null, budgetedCents: 99999 })]);
    expect(series[0].netBudgetedCents).toBe(0);
    expect(series[0].netActualCents).toBe(0);
  });

  it('partial actuals within a month: unactualized entries contribute 0 to the actual sum', () => {
    const series = buildMonthlySeries([
      row({ month: 3, direction: 'expense', budgetedCents: 1000, actualCents: 900 }),
      row({ month: 3, direction: 'expense', budgetedCents: 2000, actualCents: null }),
    ]);
    expect(series[2]).toMatchObject({
      budgetedExpenseCents: 3000,
      actualExpenseCents: 900,
      hasActuals: true,
    });
  });

  it('accepts a row shape narrower than the full DashboardEntryRow (only month/direction/budgetedCents/actualCents)', () => {
    // Exactly the shape lib/db/queries.ts's getDashboardRowsForMonth returns for the
    // recap cron's single-month fetch.
    const series = buildMonthlySeries([
      { month: 6, direction: 'income' as const, budgetedCents: 1000, actualCents: null },
    ]);
    expect(series[5]).toMatchObject({ budgetedIncomeCents: 1000, hasActuals: false });
  });
});

describe('sumMonthlySeries', () => {
  it('sums an all-zero year to all zeros, no NaN', () => {
    const totals = sumMonthlySeries(buildMonthlySeries([]));
    expect(totals).toEqual({
      budgetedIncomeCents: 0,
      actualIncomeCents: 0,
      budgetedExpenseCents: 0,
      actualExpenseCents: 0,
      netBudgetedCents: 0,
      netActualCents: 0,
    });
  });
});

describe('buildCategoryBreakdown', () => {
  it('is expense-only and excludes income/uncategorized rows', () => {
    const points = buildCategoryBreakdown([
      row({ direction: 'income', categoryId: 'cat-income' }),
      row({ direction: null, categoryId: null }),
      row({ direction: 'expense', categoryId: 'cat-1', budgetedCents: 5000 }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].categoryId).toBe('cat-1');
  });

  it('sorts by total budgeted descending', () => {
    const points = buildCategoryBreakdown([
      row({ categoryId: 'small', categoryName: 'Small', budgetedCents: 1000 }),
      row({ categoryId: 'big', categoryName: 'Big', budgetedCents: 9000 }),
    ]);
    expect(points.map((p) => p.categoryId)).toEqual(['big', 'small']);
  });

  it('tracks actualized vs total count for progress display', () => {
    const points = buildCategoryBreakdown([
      row({ categoryId: 'cat-1', actualCents: 100 }),
      row({ categoryId: 'cat-1', actualCents: null }),
    ]);
    expect(points[0]).toMatchObject({ actualizedCount: 1, totalCount: 2 });
  });
});

describe('buildCumulativeSavings', () => {
  it('returns a monotonic running total across all 12 months for an empty year', () => {
    const points = buildCumulativeSavings([]);
    expect(points).toHaveLength(12);
    expect(points.every((p) => p.cumulativeNetCents === 0)).toBe(true);
  });

  it('accumulates income minus expense across months, coalescing to budgeted when unactualized', () => {
    const points = buildCumulativeSavings([
      row({ month: 1, direction: 'income', budgetedCents: 5000, actualCents: 6000 }),
      row({ month: 1, direction: 'expense', budgetedCents: 2000, actualCents: null }),
      row({ month: 2, direction: 'income', budgetedCents: 1000, actualCents: null }),
    ]);
    // Month 1: income 6000 (actual) - expense 2000 (budgeted fallback) = 4000
    expect(points[0].cumulativeNetCents).toBe(4000);
    // Month 2 adds 1000 (budgeted fallback) on top: 5000
    expect(points[1].cumulativeNetCents).toBe(5000);
    // Carries forward unchanged through the rest of the year
    expect(points[11].cumulativeNetCents).toBe(5000);
  });
});

describe('buildFixedVsVariable', () => {
  it('splits expense entries by recurring-template presence', () => {
    const result = buildFixedVsVariable([
      row({ direction: 'expense', recurringScheduleId: 'rs-1', budgetedCents: 3000 }),
      row({ direction: 'expense', recurringScheduleId: null, budgetedCents: 500 }),
      row({ direction: 'income', recurringScheduleId: null, budgetedCents: 99999 }),
    ]);
    expect(result).toEqual({ fixedExpenseCents: 3000, variableExpenseCents: 500 });
  });

  it('is all-zero for a year with no expense rows', () => {
    expect(buildFixedVsVariable([])).toEqual({ fixedExpenseCents: 0, variableExpenseCents: 0 });
  });
});

describe('buildBankSummary', () => {
  it('excludes rows with no linked bank account', () => {
    const points = buildBankSummary([row({ bankAccountId: null })]);
    expect(points).toHaveLength(0);
  });

  it('sums inflow/outflow per account, preferring actual over budgeted', () => {
    const points = buildBankSummary([
      row({
        bankAccountId: 'acc-1',
        bankAccountName: 'Checking',
        direction: 'income',
        budgetedCents: 1000,
        actualCents: 1200,
      }),
      row({
        bankAccountId: 'acc-1',
        bankAccountName: 'Checking',
        direction: 'expense',
        budgetedCents: 400,
        actualCents: null,
      }),
    ]);
    expect(points[0]).toMatchObject({ totalInflowCents: 1200, totalOutflowCents: 400 });
  });
});

describe('sumIncomeExpense', () => {
  it('sums income and expense separately, using best-estimate (actual, falling back to budgeted) per row', () => {
    const result = sumIncomeExpense([
      row({ direction: 'income', budgetedCents: 5000, actualCents: 5500 }),
      row({ direction: 'income', budgetedCents: 2000, actualCents: null }),
      row({ direction: 'expense', budgetedCents: 1000, actualCents: 900 }),
    ]);
    expect(result).toEqual({ incomeCents: 5500 + 2000, expenseCents: 900 });
  });

  it('excludes uncategorized (direction: null) rows from both totals', () => {
    const result = sumIncomeExpense([
      row({ direction: null, budgetedCents: 99999, actualCents: 99999 }),
      row({ direction: 'income', budgetedCents: 100, actualCents: null }),
    ]);
    expect(result).toEqual({ incomeCents: 100, expenseCents: 0 });
  });

  it('returns zero totals for an empty array', () => {
    expect(sumIncomeExpense([])).toEqual({ incomeCents: 0, expenseCents: 0 });
  });

  it('accepts a row shape narrower than the full DashboardEntryRow (only direction/budgetedCents/actualCents)', () => {
    // Exercises the narrowed parameter type directly — this is exactly the shape
    // lib/db/queries.ts's getIncomeExpenseRows returns for the dashboard's YoY prior
    // year, deliberately leaner than a full DashboardEntryRow.
    const result = sumIncomeExpense([
      { direction: 'expense', budgetedCents: 300, actualCents: null },
    ]);
    expect(result).toEqual({ incomeCents: 0, expenseCents: 300 });
  });
});

describe('buildYoyDelta', () => {
  it('handles a completely absent prior year without NaN/Infinity', () => {
    const result = buildYoyDelta(
      { incomeCents: 10000, expenseCents: 5000 },
      { incomeCents: 0, expenseCents: 0 },
    );
    expect(result.incomePercent).toBeNull();
    expect(result.expensePercent).toBeNull();
    expect(result.incomeDeltaCents).toBe(10000);
    expect(Number.isNaN(result.incomeDeltaCents)).toBe(false);
  });

  it('computes a normal percentage delta', () => {
    const result = buildYoyDelta(
      { incomeCents: 12000, expenseCents: 8000 },
      { incomeCents: 10000, expenseCents: 10000 },
    );
    expect(result.incomePercent).toBeCloseTo(20, 5);
    expect(result.expensePercent).toBeCloseTo(-20, 5);
  });

  it('handles both years being zero', () => {
    const result = buildYoyDelta(
      { incomeCents: 0, expenseCents: 0 },
      { incomeCents: 0, expenseCents: 0 },
    );
    expect(result.incomePercent).toBeNull();
    expect(result.incomeDeltaCents).toBe(0);
  });
});
