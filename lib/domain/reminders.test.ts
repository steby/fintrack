import { describe, expect, it } from 'vitest';
import { selectUpcomingBills, daysInMonth, type UpcomingBillCandidate } from './reminders';

describe('daysInMonth', () => {
  it('returns 31 for a 31-day month', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
  });

  it('returns 30 for a 30-day month', () => {
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('returns 28 for February in a non-leap year', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('returns 29 for February in a leap year', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it('handles December correctly (month 12, not a year-rollover edge case)', () => {
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

function candidate(overrides: Partial<UpcomingBillCandidate> = {}): UpcomingBillCandidate {
  return {
    id: 'entry-1',
    item: 'Rent',
    year: 2026,
    month: 7,
    actualDateDay: 12,
    actualAmount: null,
    budgetedAmount: '2000.00',
    ...overrides,
  };
}

describe('selectUpcomingBills', () => {
  const today = new Date('2026-07-09T12:00:00Z');

  it('selects a bill due within the window', () => {
    const result = selectUpcomingBills([candidate({ actualDateDay: 12 })], today);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'entry-1', dueDate: '2026-07-12', daysUntilDue: 3 });
  });

  it('includes a bill due today (0 days out)', () => {
    const result = selectUpcomingBills([candidate({ actualDateDay: 9 })], today);
    expect(result).toHaveLength(1);
    expect(result[0].daysUntilDue).toBe(0);
  });

  it('excludes a bill exactly one day past the window', () => {
    const result = selectUpcomingBills([candidate({ actualDateDay: 13 })], today);
    expect(result).toHaveLength(0);
  });

  it('excludes an already-overdue unpaid bill', () => {
    const result = selectUpcomingBills([candidate({ actualDateDay: 1 })], today);
    expect(result).toHaveLength(0);
  });

  it('excludes a bill that already has an actual amount (already paid)', () => {
    const result = selectUpcomingBills(
      [candidate({ actualDateDay: 12, actualAmount: '2000.00' })],
      today,
    );
    expect(result).toHaveLength(0);
  });

  it('excludes an entry with no fixed due day', () => {
    const result = selectUpcomingBills([candidate({ actualDateDay: null })], today);
    expect(result).toHaveLength(0);
  });

  it('clamps a day-31 item in a 30-day month to the 30th', () => {
    // April has 30 days; today is set close enough that day 30 falls in-window.
    const aprilToday = new Date('2026-04-28T00:00:00Z');
    const result = selectUpcomingBills(
      [candidate({ year: 2026, month: 4, actualDateDay: 31 })],
      aprilToday,
    );
    expect(result).toHaveLength(1);
    expect(result[0].dueDate).toBe('2026-04-30');
    expect(result[0].daysUntilDue).toBe(2);
  });

  it('clamps a day-31 item in February (non-leap year) to the 28th', () => {
    const febToday = new Date('2027-02-26T00:00:00Z'); // 2027 is not a leap year
    const result = selectUpcomingBills(
      [candidate({ year: 2027, month: 2, actualDateDay: 31 })],
      febToday,
    );
    expect(result).toHaveLength(1);
    expect(result[0].dueDate).toBe('2027-02-28');
  });

  it('clamps a day-31 item in February in a leap year to the 29th', () => {
    const febToday = new Date('2028-02-27T00:00:00Z'); // 2028 is a leap year
    const result = selectUpcomingBills(
      [candidate({ year: 2028, month: 2, actualDateDay: 31 })],
      febToday,
    );
    expect(result).toHaveLength(1);
    expect(result[0].dueDate).toBe('2028-02-29');
  });

  it('sorts multiple selected bills soonest-first', () => {
    const result = selectUpcomingBills(
      [
        candidate({ id: 'a', actualDateDay: 12 }),
        candidate({ id: 'b', actualDateDay: 9 }),
        candidate({ id: 'c', actualDateDay: 10 }),
      ],
      today,
    );
    expect(result.map((b) => b.id)).toEqual(['b', 'c', 'a']);
  });

  it('returns an empty array when there are no candidates (no empty-email edge case handled upstream)', () => {
    expect(selectUpcomingBills([], today)).toEqual([]);
  });
});
