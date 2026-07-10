import { describe, expect, it } from 'vitest';
import { computeBudgetProgress, computeGoalProgress } from './budgeting';

describe('computeBudgetProgress', () => {
  it('treats an unset cap (null) as having no percentage at all', () => {
    const result = computeBudgetProgress(50000, null);
    expect(result).toEqual({
      spentCents: 50000,
      capCents: null,
      percentage: null,
      isOverCap: false,
    });
  });

  it('treats an explicit zero cap as distinct from unset — any spend at all overspends', () => {
    const result = computeBudgetProgress(100, 0);
    expect(result.isOverCap).toBe(true);
    expect(result.percentage).toBe(100);
  });

  it('a zero cap with zero spend is not an overspend', () => {
    const result = computeBudgetProgress(0, 0);
    expect(result).toEqual({ spentCents: 0, capCents: 0, percentage: 0, isOverCap: false });
  });

  it('computes a normal percentage under cap', () => {
    const result = computeBudgetProgress(5000, 10000);
    expect(result).toEqual({ spentCents: 5000, capCents: 10000, percentage: 50, isOverCap: false });
  });

  it('renders an uncapped percentage over 100 for overspend, not clamped', () => {
    const result = computeBudgetProgress(15000, 10000);
    expect(result.percentage).toBe(150);
    expect(result.isOverCap).toBe(true);
  });

  it('spending exactly the cap is not an overspend', () => {
    const result = computeBudgetProgress(10000, 10000);
    expect(result.isOverCap).toBe(false);
    expect(result.percentage).toBe(100);
  });
});

describe('computeGoalProgress', () => {
  const createdAt = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-07-01T00:00:00Z'); // 181 days later

  it('is not complete and has no overdue flag with no target date', () => {
    const result = computeGoalProgress(50000, 100000, createdAt, null, now);
    expect(result.isComplete).toBe(false);
    expect(result.isOverdue).toBe(false);
    expect(result.percentage).toBe(50);
  });

  it('flags a goal with a past target date, not yet complete, as overdue', () => {
    const pastTarget = new Date('2026-03-01T00:00:00Z');
    const result = computeGoalProgress(50000, 100000, createdAt, pastTarget, now);
    expect(result.isOverdue).toBe(true);
  });

  it('does not flag a completed goal as overdue even with a past target date', () => {
    const pastTarget = new Date('2026-03-01T00:00:00Z');
    const result = computeGoalProgress(100000, 100000, createdAt, pastTarget, now);
    expect(result.isComplete).toBe(true);
    expect(result.isOverdue).toBe(false);
  });

  it('does not flag a goal overdue on its own due date, even hours into the day (day-granularity, not instant)', () => {
    const targetDate = new Date('2026-07-01T00:00:00Z');
    const laterSameDay = new Date('2026-07-01T23:00:00Z');
    const result = computeGoalProgress(50000, 100000, createdAt, targetDate, laterSameDay);
    expect(result.isOverdue).toBe(false);
  });

  it('flags a goal overdue starting the day after its target date', () => {
    const targetDate = new Date('2026-07-01T00:00:00Z');
    const nextDay = new Date('2026-07-02T00:00:01Z');
    const result = computeGoalProgress(50000, 100000, createdAt, targetDate, nextDay);
    expect(result.isOverdue).toBe(true);
  });

  it('never produces NaN/Infinity for a zero-target goal', () => {
    const result = computeGoalProgress(0, 0, createdAt, null, now);
    expect(Number.isFinite(result.percentage)).toBe(true);
    expect(result.isComplete).toBe(true);
  });

  it('has no projected completion date with zero progress so far', () => {
    const result = computeGoalProgress(0, 100000, createdAt, null, now);
    expect(result.projectedCompletionDate).toBeNull();
  });

  it('has no projected completion date once already complete', () => {
    const result = computeGoalProgress(100000, 100000, createdAt, null, now);
    expect(result.projectedCompletionDate).toBeNull();
  });

  it('projects a future completion date from the linear savings rate so far', () => {
    // 50000 saved over 181 days = ~276.24/day; 50000 remaining => ~181 more days.
    const result = computeGoalProgress(50000, 100000, createdAt, null, now);
    expect(result.projectedCompletionDate).not.toBeNull();
    expect(new Date(result.projectedCompletionDate!).getTime()).toBeGreaterThan(now.getTime());
  });

  it('allows remainingCents to go negative when saved has overshot the target', () => {
    const result = computeGoalProgress(150000, 100000, createdAt, null, now);
    expect(result.remainingCents).toBe(-50000);
    expect(result.isComplete).toBe(true);
  });

  it('returns a null projection instead of throwing when the linear rate projects past the max representable date', () => {
    // 1 cent saved against a target near moneyInputSchema's 10-digit cap (schema-legal,
    // see app/actions/goals.ts) yields a daily rate so small that a naive projection
    // overflows the ECMAScript max time value (8.64e15ms from epoch) — this used to
    // throw RangeError out of .toISOString() instead of degrading gracefully.
    const result = computeGoalProgress(1, 999_999_999_999, createdAt, null, now);
    expect(result.projectedCompletionDate).toBeNull();
  });
});
