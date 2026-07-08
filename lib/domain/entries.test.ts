import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { shouldPropagate, getDifference } from './entries';

describe('shouldPropagate', () => {
  it('propagates a plain forecast row (no actual, not overridden)', () => {
    expect(shouldPropagate({ actualCents: null, isOverridden: false })).toBe(true);
  });

  it('does not propagate an actualized row', () => {
    expect(shouldPropagate({ actualCents: 500, isOverridden: false })).toBe(false);
  });

  it('does not propagate an overridden row, even without an actual yet', () => {
    expect(shouldPropagate({ actualCents: null, isOverridden: true })).toBe(false);
  });

  it('does not propagate a row that is both actualized and overridden', () => {
    expect(shouldPropagate({ actualCents: 500, isOverridden: true })).toBe(false);
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
