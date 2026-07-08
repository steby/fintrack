import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseScheduleMonths, shouldGenerate, walkMonths, type YearMonth } from './recurring';

describe('parseScheduleMonths', () => {
  it('returns [] for null/empty', () => {
    expect(parseScheduleMonths(null)).toEqual([]);
    expect(parseScheduleMonths('')).toEqual([]);
  });

  it('parses a valid comma-separated list', () => {
    expect(parseScheduleMonths('1,4,7,10')).toEqual([1, 4, 7, 10]);
  });

  it('trims whitespace around entries', () => {
    expect(parseScheduleMonths(' 1 , 4 ,7')).toEqual([1, 4, 7]);
  });

  it('sorts and deduplicates', () => {
    expect(parseScheduleMonths('7,1,7,4')).toEqual([1, 4, 7]);
  });

  it('filters out-of-range and malformed entries (adversarial: "13,0,abc")', () => {
    expect(parseScheduleMonths('13,0,abc')).toEqual([]);
  });

  it('keeps valid entries alongside malformed ones', () => {
    expect(parseScheduleMonths('13,6,abc,12')).toEqual([6, 12]);
  });

  it('handles boundary months 1 and 12', () => {
    expect(parseScheduleMonths('1,12')).toEqual([1, 12]);
  });
});

describe('shouldGenerate', () => {
  it('Monthly always generates', () => {
    for (let m = 1; m <= 12; m++) {
      expect(shouldGenerate('Monthly', null, m)).toBe(true);
    }
  });

  it('Quarterly generates only in scheduled months', () => {
    expect(shouldGenerate('Quarterly', '1,4,7,10', 4)).toBe(true);
    expect(shouldGenerate('Quarterly', '1,4,7,10', 5)).toBe(false);
  });

  it('Yearly generates only in its one scheduled month', () => {
    expect(shouldGenerate('Yearly', '6', 6)).toBe(true);
    expect(shouldGenerate('Yearly', '6', 7)).toBe(false);
  });

  it('Quarterly/Yearly with malformed schedule_months never generates (fails safe, not throws)', () => {
    expect(shouldGenerate('Quarterly', '13,0,abc', 1)).toBe(false);
    expect(shouldGenerate('Yearly', null, 1)).toBe(false);
  });
});

describe('walkMonths', () => {
  it('walks a simple same-year range inclusively', () => {
    expect(walkMonths({ year: 2026, month: 3 }, { year: 2026, month: 5 })).toEqual([
      { year: 2026, month: 3 },
      { year: 2026, month: 4 },
      { year: 2026, month: 5 },
    ]);
  });

  it('crosses a year boundary (Dec -> Jan)', () => {
    expect(walkMonths({ year: 2026, month: 11 }, { year: 2027, month: 2 })).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 },
    ]);
  });

  it('returns a single month when from === to', () => {
    expect(walkMonths({ year: 2026, month: 7 }, { year: 2026, month: 7 })).toEqual([
      { year: 2026, month: 7 },
    ]);
  });

  it('returns [] for a reversed range', () => {
    expect(walkMonths({ year: 2026, month: 7 }, { year: 2026, month: 1 })).toEqual([]);
    expect(walkMonths({ year: 2027, month: 1 }, { year: 2026, month: 12 })).toEqual([]);
  });
});

const yearMonthArb = fc.record({
  year: fc.integer({ min: 2000, max: 2100 }),
  month: fc.integer({ min: 1, max: 12 }),
});

function toOrdinal({ year, month }: YearMonth): number {
  return year * 12 + month;
}

describe('walkMonths (property)', () => {
  it('never skips or duplicates a month — output is a contiguous, strictly increasing run', () => {
    fc.assert(
      fc.property(yearMonthArb, yearMonthArb, (from, to) => {
        const months = walkMonths(from, to);
        for (let i = 1; i < months.length; i++) {
          // i is bounded by months.length from the loop condition above, not external
          // input — eslint-plugin-security's object-injection check can't see that.
          // eslint-disable-next-line security/detect-object-injection
          expect(toOrdinal(months[i])).toBe(toOrdinal(months[i - 1]) + 1);
        }
      }),
    );
  });

  it('length matches the ordinal distance between from and to (inclusive), or 0 if reversed', () => {
    fc.assert(
      fc.property(yearMonthArb, yearMonthArb, (from, to) => {
        const months = walkMonths(from, to);
        const expectedLength = Math.max(0, toOrdinal(to) - toOrdinal(from) + 1);
        expect(months.length).toBe(expectedLength);
      }),
    );
  });

  it('every emitted month field is a valid calendar month (1-12)', () => {
    fc.assert(
      fc.property(yearMonthArb, yearMonthArb, (from, to) => {
        const months = walkMonths(from, to);
        for (const { month } of months) {
          expect(month).toBeGreaterThanOrEqual(1);
          expect(month).toBeLessThanOrEqual(12);
        }
      }),
    );
  });
});
