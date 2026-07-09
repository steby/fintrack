import { describe, it, expect } from 'vitest';
import { isUnusuallyLargeRowCount, UNBOUNDED_QUERY_ROW_WARNING_THRESHOLD } from './query-limits';

describe('isUnusuallyLargeRowCount', () => {
  it('is false for zero and typical household-scale counts', () => {
    expect(isUnusuallyLargeRowCount(0)).toBe(false);
    expect(isUnusuallyLargeRowCount(500)).toBe(false);
  });

  it('is false exactly at the threshold (boundary is inclusive of "normal")', () => {
    expect(isUnusuallyLargeRowCount(UNBOUNDED_QUERY_ROW_WARNING_THRESHOLD)).toBe(false);
  });

  it('is true one row past the threshold', () => {
    expect(isUnusuallyLargeRowCount(UNBOUNDED_QUERY_ROW_WARNING_THRESHOLD + 1)).toBe(true);
  });
});
