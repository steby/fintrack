import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  parseYearParam,
  parseMonthParam,
  parseViewParam,
  monthNav,
  isValidCalendarDate,
} from './month-params';

describe('parseYearParam', () => {
  it('parses a valid year', () => {
    expect(parseYearParam('2026')).toBe(2026);
  });

  it('falls back to the current year for undefined', () => {
    expect(parseYearParam(undefined)).toBe(new Date().getFullYear());
  });

  it('falls back to the current year for non-numeric garbage (adversarial: ?year=abc)', () => {
    expect(parseYearParam('abc')).toBe(new Date().getFullYear());
  });

  it('clamps an absurdly large year (adversarial: ?year=99999)', () => {
    expect(parseYearParam('99999')).toBe(new Date().getFullYear());
  });

  it('clamps a negative/tiny year', () => {
    expect(parseYearParam('-5')).toBe(new Date().getFullYear());
    expect(parseYearParam('0')).toBe(new Date().getFullYear());
  });

  it('takes the first value when given an array (repeated query param)', () => {
    expect(parseYearParam(['2027', '2028'])).toBe(2027);
  });
});

describe('parseMonthParam', () => {
  it('parses a valid month', () => {
    expect(parseMonthParam('7')).toBe(7);
  });

  it('falls back to the current month for out-of-range values', () => {
    expect(parseMonthParam('13')).toBe(new Date().getMonth() + 1);
    expect(parseMonthParam('0')).toBe(new Date().getMonth() + 1);
  });

  it('falls back to the current month for non-numeric garbage', () => {
    expect(parseMonthParam('abc')).toBe(new Date().getMonth() + 1);
  });

  it('accepts the boundary months 1 and 12', () => {
    expect(parseMonthParam('1')).toBe(1);
    expect(parseMonthParam('12')).toBe(12);
  });
});

describe('parseViewParam', () => {
  it('recognizes all three explicit modes from the URL param', () => {
    expect(parseViewParam('agenda')).toBe('agenda');
    expect(parseViewParam('list')).toBe('list');
    expect(parseViewParam('calendar')).toBe('calendar');
  });

  it('defaults to agenda (not calendar — Phase 10 changed the default) when nothing is present', () => {
    expect(parseViewParam(undefined)).toBe('agenda');
  });

  it('defaults to agenda for URL garbage, ignoring any cookie fallback entirely (adversarial: ?view=<script>)', () => {
    expect(parseViewParam('<script>')).toBe('agenda');
  });

  it('takes the first value when given an array (repeated query param)', () => {
    expect(parseViewParam(['list', 'calendar'])).toBe('list');
  });

  it('falls back to a valid cookie value when the URL param is absent', () => {
    expect(parseViewParam(undefined, 'list')).toBe('list');
    expect(parseViewParam(undefined, 'calendar')).toBe('calendar');
  });

  it('the URL param wins over a valid cookie value', () => {
    expect(parseViewParam('calendar', 'list')).toBe('calendar');
  });

  it('falls back to agenda when the cookie is garbage/tampered (adversarial: a forged fintrack_view cookie)', () => {
    expect(parseViewParam(undefined, '<script>alert(1)</script>')).toBe('agenda');
    expect(parseViewParam(undefined, '')).toBe('agenda');
    expect(parseViewParam(undefined, 'AGENDA')).toBe('agenda'); // case-sensitive, no normalization
  });
});

describe('monthNav', () => {
  it('steps within a year', () => {
    expect(monthNav(2026, 7)).toEqual({
      prev: { year: 2026, month: 6 },
      next: { year: 2026, month: 8 },
    });
  });

  it('crosses the year boundary forward (Dec -> Jan)', () => {
    expect(monthNav(2026, 12)).toEqual({
      prev: { year: 2026, month: 11 },
      next: { year: 2027, month: 1 },
    });
  });

  it('crosses the year boundary backward (Jan -> Dec)', () => {
    expect(monthNav(2026, 1)).toEqual({
      prev: { year: 2025, month: 12 },
      next: { year: 2026, month: 2 },
    });
  });
});

describe('isValidCalendarDate', () => {
  it('accepts real calendar dates, including a leap day', () => {
    expect(isValidCalendarDate('2026-01-05')).toBe(true);
    expect(isValidCalendarDate('2024-02-29')).toBe(true);
  });

  it('rejects a calendar-impossible date instead of silently rolling over (e.g. Feb 30, or Feb 29 in a non-leap year)', () => {
    expect(isValidCalendarDate('2026-02-30')).toBe(false);
    expect(isValidCalendarDate('2026-02-29')).toBe(false);
  });

  it('rejects a shape-invalid string', () => {
    expect(isValidCalendarDate('not-a-date')).toBe(false);
  });
});

describe('current-date-dependent fallbacks', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parseYearParam/parseMonthParam track a mocked system clock, not a hardcoded value', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-05-15T00:00:00Z'));
    expect(parseYearParam(undefined)).toBe(2030);
    expect(parseMonthParam(undefined)).toBe(5);
  });
});
