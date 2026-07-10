import { utcDaysBetween } from './today';

// Pure logic for Phase 4's category budgets and savings goals — spec.md's Ready
// criteria calls out "budget of 0 vs null (unset ≠ zero cap)" and "goal with past
// target_date" as edge cases; both are handled explicitly below rather than left to
// fall out of generic arithmetic.

export interface BudgetProgress {
  spentCents: number;
  capCents: number | null;
  // 0-100+, uncapped so a widget can render an overflow state distinctly from "at
  // capacity" — null only when there's no cap at all (capCents === null), meaning
  // there's nothing to compute a percentage against.
  percentage: number | null;
  isOverCap: boolean;
}

// capCents === null means "no cap set" (unset) — never treated as capCents === 0
// ("cap explicitly set to zero," i.e. "budget nothing here," where ANY spend at all
// is an immediate overspend).
export function computeBudgetProgress(spentCents: number, capCents: number | null): BudgetProgress {
  if (capCents === null) {
    return { spentCents, capCents: null, percentage: null, isOverCap: false };
  }
  if (capCents === 0) {
    return {
      spentCents,
      capCents: 0,
      percentage: spentCents > 0 ? 100 : 0,
      isOverCap: spentCents > 0,
    };
  }
  return {
    spentCents,
    capCents,
    percentage: (spentCents / capCents) * 100,
    isOverCap: spentCents > capCents,
  };
}

export interface GoalProgress {
  savedCents: number;
  targetCents: number;
  percentage: number; // 0-100+, uncapped
  remainingCents: number; // can be negative if saved has overshot target
  isComplete: boolean;
  isOverdue: boolean;
  // Naive linear projection: extrapolates from the goal's own average savings rate
  // since creation (savedCents accumulated over the days since createdAt) — "linear
  // from savings deltas" in the simplest sense available, since saved_amount is a
  // single manually-edited value with no history table to fit a trend against. Null
  // when there's no progress yet to extrapolate from, or the goal is already complete.
  projectedCompletionDate: string | null;
}

export function computeGoalProgress(
  savedCents: number,
  targetCents: number,
  createdAt: Date,
  targetDate: Date | null,
  now: Date = new Date(),
): GoalProgress {
  const isComplete = savedCents >= targetCents;
  const percentage = targetCents > 0 ? (savedCents / targetCents) * 100 : savedCents > 0 ? 100 : 0;
  const remainingCents = targetCents - savedCents;
  // Day-granularity, not raw instant comparison (spec.md Phase 6 pre-decision — shared
  // UTC "today" concept): a goal due today isn't overdue until tomorrow. The previous
  // instant-based comparison had a real off-by-one here, flagging a goal overdue for
  // however many hours were left in its own due date.
  const isOverdue = targetDate !== null && !isComplete && utcDaysBetween(now, targetDate) < 0;

  let projectedCompletionDate: string | null = null;
  if (!isComplete && savedCents > 0) {
    const daysSinceCreated = Math.max(
      1,
      (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    const dailyRateCents = savedCents / daysSinceCreated;
    if (dailyRateCents > 0) {
      const daysRemaining = remainingCents / dailyRateCents;
      const projected = new Date(now.getTime() + daysRemaining * 24 * 60 * 60 * 1000);
      // A near-zero saving rate against a large target can push `projected` past the
      // ECMAScript max time value (8.64e15ms from epoch), producing an Invalid Date —
      // .toISOString() throws RangeError on that rather than returning a sentinel, so
      // this must be checked before calling it. A projection that far out isn't
      // meaningful to show anyway; null (no projection) is the correct result, same as
      // the "no progress yet" case above.
      if (!Number.isNaN(projected.getTime())) {
        projectedCompletionDate = projected.toISOString().slice(0, 10);
      }
    }
  }

  return {
    savedCents,
    targetCents,
    percentage,
    remainingCents,
    isComplete,
    isOverdue,
    projectedCompletionDate,
  };
}
