import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { shouldPropagate, getDifference, entryPaidState, entrySettleLabels } from './entries';

describe('entrySettleLabels', () => {
  it('uses "received" wording for income', () => {
    const labels = entrySettleLabels('income');
    expect(labels.action).toBe('Mark received');
    expect(labels.past).toBe('received');
    expect(labels.failure).toBe('Could not mark received');
  });

  it('uses "paid" wording for expense', () => {
    const labels = entrySettleLabels('expense');
    expect(labels.action).toBe('Mark paid');
    expect(labels.past).toBe('paid');
    expect(labels.failure).toBe('Could not mark paid');
  });

  it('defaults an uncategorized (null-direction) entry to expense wording', () => {
    expect(entrySettleLabels(null)).toEqual(entrySettleLabels('expense'));
  });
});

describe('shouldPropagate', () => {
  it('propagates a plain forecast row (no actual, not overridden)', () => {
    expect(shouldPropagate({ actualCents: null, actualDate: null, isOverridden: false })).toBe(
      true,
    );
  });

  it('does not propagate an actualized row', () => {
    expect(
      shouldPropagate({ actualCents: 500, actualDate: '2026-01-05', isOverridden: false }),
    ).toBe(false);
  });

  it('does not propagate an overridden row, even without an actual yet', () => {
    expect(shouldPropagate({ actualCents: null, actualDate: null, isOverridden: true })).toBe(
      false,
    );
  });

  it('does not propagate a row that is both actualized and overridden', () => {
    expect(
      shouldPropagate({ actualCents: 500, actualDate: '2026-01-05', isOverridden: true }),
    ).toBe(false);
  });

  it('does not propagate a row with a recorded payment date but a still-blank amount (regression: partial actualization must count as actualized)', () => {
    // updateActualAction genuinely allows saving just a date with the amount left
    // empty (monthly.ts's optionalMoneyInputSchema) — this must be treated the same
    // as a fully-actualized row, not as a still-safe-to-overwrite forecast, or a later
    // propagate/removeForecast would silently delete/clobber the date the user
    // already recorded.
    expect(
      shouldPropagate({ actualCents: null, actualDate: '2026-01-05', isOverridden: false }),
    ).toBe(false);
  });

  it('does not propagate a row with an actual amount but no date (the inverse partial case, for symmetry)', () => {
    expect(shouldPropagate({ actualCents: 500, actualDate: null, isOverridden: false })).toBe(
      false,
    );
  });
});

describe('getDifference', () => {
  it('returns null when no actual has been entered yet', () => {
    expect(
      getDifference({ direction: 'income', budgetedCents: 1000, actualCents: null }),
    ).toBeNull();
  });

  it('income: earning more than budgeted is favorable', () => {
    expect(getDifference({ direction: 'income', budgetedCents: 1000, actualCents: 1200 })).toEqual({
      cents: 200,
      favorable: true,
    });
  });

  it('income: earning less than budgeted is unfavorable', () => {
    expect(getDifference({ direction: 'income', budgetedCents: 1000, actualCents: 800 })).toEqual({
      cents: -200,
      favorable: false,
    });
  });

  it('expense: spending less than budgeted is favorable', () => {
    expect(getDifference({ direction: 'expense', budgetedCents: 1000, actualCents: 800 })).toEqual({
      cents: 200,
      favorable: true,
    });
  });

  it('expense: spending more than budgeted is unfavorable', () => {
    expect(getDifference({ direction: 'expense', budgetedCents: 1000, actualCents: 1200 })).toEqual(
      {
        cents: -200,
        favorable: false,
      },
    );
  });

  it('exact match is favorable (>= 0, not > 0)', () => {
    expect(getDifference({ direction: 'expense', budgetedCents: 1000, actualCents: 1000 })).toEqual(
      {
        cents: 0,
        favorable: true,
      },
    );
  });
});

describe('entryPaidState', () => {
  const today = new Date('2026-07-12T00:00:00Z');

  it('paid beats everything, even an entry with no due day at all', () => {
    expect(
      entryPaidState({ actualAmount: '50.00', actualDateDay: null, year: 2026, month: 7 }, today),
    ).toBe('paid');
  });

  it('paid beats an overdue due day', () => {
    expect(
      entryPaidState({ actualAmount: '50.00', actualDateDay: 1, year: 2026, month: 7 }, today),
    ).toBe('paid');
  });

  it('no due day (ad-hoc, or a recurring item with none configured) is unscheduled', () => {
    expect(
      entryPaidState({ actualAmount: null, actualDateDay: null, year: 2026, month: 7 }, today),
    ).toBe('unscheduled');
  });

  it('clamps day 31 to Feb 28 in a non-leap year and reports overdue once that date has passed', () => {
    expect(
      entryPaidState({ actualAmount: null, actualDateDay: 31, year: 2026, month: 2 }, today),
    ).toBe('overdue');
  });

  it('clamps day 31 to Feb 29 in a leap year', () => {
    const leapToday = new Date('2024-03-01T00:00:00Z');
    expect(
      entryPaidState({ actualAmount: null, actualDateDay: 31, year: 2024, month: 2 }, leapToday),
    ).toBe('overdue');
    // Still upcoming the day before the clamped due date.
    expect(
      entryPaidState(
        { actualAmount: null, actualDateDay: 31, year: 2024, month: 2 },
        new Date('2024-02-28T00:00:00Z'),
      ),
    ).toBe('upcoming');
  });

  it('due exactly today is upcoming, not overdue (the today boundary)', () => {
    expect(
      entryPaidState({ actualAmount: null, actualDateDay: 12, year: 2026, month: 7 }, today),
    ).toBe('upcoming');
  });

  it('due tomorrow is upcoming', () => {
    expect(
      entryPaidState({ actualAmount: null, actualDateDay: 13, year: 2026, month: 7 }, today),
    ).toBe('upcoming');
  });

  it('an unpaid entry from a past month is overdue too, not just the current month (unlike affordability.ts)', () => {
    expect(
      entryPaidState({ actualAmount: null, actualDateDay: 15, year: 2026, month: 1 }, today),
    ).toBe('overdue');
  });

  it('an unpaid entry from a future month is upcoming, not overdue', () => {
    expect(
      entryPaidState({ actualAmount: null, actualDateDay: 5, year: 2026, month: 12 }, today),
    ).toBe('upcoming');
  });
});

describe('getDifference (property)', () => {
  it('never returns NaN and favorable always matches the sign of cents', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'income' | 'expense'>('income', 'expense'),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (direction, budgetedCents, actualCents) => {
          const diff = getDifference({ direction, budgetedCents, actualCents });
          expect(diff).not.toBeNull();
          expect(Number.isNaN(diff!.cents)).toBe(false);
          expect(diff!.favorable).toBe(diff!.cents >= 0);
        },
      ),
    );
  });
});
