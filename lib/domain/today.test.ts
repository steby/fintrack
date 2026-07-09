import { describe, expect, it } from 'vitest';
import { utcStartOfDay, utcDaysBetween } from './today';

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
