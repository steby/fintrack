import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { deriveMonthStatus } from './month-status';

describe('deriveMonthStatus', () => {
  it('empty: no entries', () => {
    expect(deriveMonthStatus(0, 0)).toBe('empty');
  });

  it('forecast: entries exist, none actualized', () => {
    expect(deriveMonthStatus(5, 0)).toBe('forecast');
  });

  it('in_progress: some but not all actualized', () => {
    expect(deriveMonthStatus(5, 2)).toBe('in_progress');
  });

  it('closed: every entry actualized', () => {
    expect(deriveMonthStatus(5, 5)).toBe('closed');
  });
});

describe('deriveMonthStatus (property)', () => {
  it('always returns exactly one of the four valid statuses, never NaN/undefined behavior', () => {
    fc.assert(
      fc.property(fc.nat(1000), fc.nat(1000), (total, actualized) => {
        const capped = Math.min(actualized, total);
        const status = deriveMonthStatus(total, capped);
        expect(['empty', 'forecast', 'in_progress', 'closed']).toContain(status);
        expect(status === 'empty').toBe(total === 0);
      }),
    );
  });
});
