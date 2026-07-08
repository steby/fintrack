export interface PropagationCandidate {
  actualCents: number | null;
  isOverridden: boolean;
}

// Only forecast rows (no actual entered yet) that haven't been manually overridden are
// safe for a recurring item's propagated edit to overwrite — actualized months are
// historical record (spec.md threat note: "never overwrite actualized rows"), and
// overridden months are the user's deliberate one-off correction that a later edit to
// the recurring template shouldn't silently clobber.
export function shouldPropagate(entry: PropagationCandidate): boolean {
  return entry.actualCents === null && !entry.isOverridden;
}

export interface DifferenceInput {
  direction: 'income' | 'expense';
  budgetedCents: number;
  actualCents: number | null;
}

export interface Difference {
  cents: number;
  favorable: boolean;
}

// Favorability is direction-aware: earning MORE than budgeted is favorable for income,
// spending LESS than budgeted is favorable for expense — the same signed difference
// means opposite things depending on direction. Ported from FinanceTracker's
// monthly/+page.svelte `getDifference`. Returns null until an actual is entered (no
// difference to show yet).
export function getDifference(entry: DifferenceInput): Difference | null {
  if (entry.actualCents === null) return null;
  const cents =
    entry.direction === 'income'
      ? entry.actualCents - entry.budgetedCents
      : entry.budgetedCents - entry.actualCents;
  return { cents, favorable: cents >= 0 };
}
