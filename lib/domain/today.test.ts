import { describe, expect, it } from 'vitest';
import { utcStartOfDay, utcDaysBetween, currentYearMonth } from './today';

describe('utcStartOfDay', () => {
  it('truncates time-of-day, staying on the same UTC calendar date', () => {
    const result = utcStartOfDay(new Date('2026-07-09T23:59:59.999Z'));
    expect(result.toISOString()).toBe('2026-07-09T00:00:00.000Z');
  });

  it('does not roll to a different date for an input near local midnight boundaries', () => {
    const result = utcStartOfDay(new Date('2026-07-09T00:00:00.001Z'));
    expect(result.toISOString()).toBe('2026-07-09T00:00:00.000Z');
  });
});

describe('utcDaysBetween', () => {
  it('is zero for two instants on the same UTC calendar day', () => {
    const a = new Date('2026-07-09T00:00:00Z');
    const b = new Date('2026-07-09T23:59:59Z');
    expect(utcDaysBetween(a, b)).toBe(0);
  });

  it('counts whole calendar days, not elapsed 24h periods', () => {
    const a = new Date('2026-07-09T23:00:00Z');
    const b = new Date('2026-07-10T01:00:00Z'); // 2h later, but a different calendar day
    expect(utcDaysBetween(a, b)).toBe(1);
  });

  it('is negative when `to` is before `from`', () => {
    const a = new Date('2026-07-09T00:00:00Z');
    const b = new Date('2026-07-06T00:00:00Z');
    expect(utcDaysBetween(a, b)).toBe(-3);
  });

  it('crosses a month/year boundary correctly', () => {
    const a = new Date('2025-12-30T00:00:00Z');
    const b = new Date('2026-01-02T00:00:00Z');
    expect(utcDaysBetween(a, b)).toBe(3);
  });
});

describe('currentYearMonth', () => {
  it('reads year/month from the UTC calendar, not local time', () => {
    expect(currentYearMonth(new Date('2026-07-15T12:00:00Z'))).toEqual({ year: 2026, month: 7 });
  });

  it('regression: a server running in a positive-offset local timezone (e.g. SGT, UTC+8) must not report a later month than UTC actually is', () => {
    // The exact bug class this function exists to close: this instant is still June 30
    // in UTC, but would already be July 1 local time in any UTC+8 timezone (like SGT)
    // if a call site used getFullYear()/getMonth() instead of the UTC accessors this
    // function uses.
    const lateJune30Utc = new Date('2026-06-30T20:00:00Z'); // 04:00 local time, UTC+8, on July 1
    expect(currentYearMonth(lateJune30Utc)).toEqual({ year: 2026, month: 6 });
  });

  it('correctly rolls over a year boundary (December -> January)', () => {
    expect(currentYearMonth(new Date('2025-12-31T23:30:00Z'))).toEqual({ year: 2025, month: 12 });
    expect(currentYearMonth(new Date('2026-01-01T00:30:00Z'))).toEqual({ year: 2026, month: 1 });
  });

  it('defaults to the real current instant when called with no argument', () => {
    const before = new Date();
    const result = currentYearMonth();
    expect(result).toEqual({ year: before.getUTCFullYear(), month: before.getUTCMonth() + 1 });
  });
});
