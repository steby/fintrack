export interface PropagationCandidate {
  actualCents: number | null;
  actualDate: string | null;
  isOverridden: boolean;
}

// Only forecast rows (no actual entered yet) that haven't been manually overridden are
// safe for a recurring item's propagated edit to overwrite — actualized months are
// historical record (spec.md threat note: "never overwrite actualized rows"), and
// overridden months are the user's deliberate one-off correction that a later edit to
// the recurring template shouldn't silently clobber. "Actualized" means EITHER field is
// set, not just actualCents: updateActualAction lets a user record just a payment date
// with the amount still blank (a real, supported partial-entry workflow — see
// monthly.ts's optionalMoneyInputSchema) — treating that row as still-a-forecast would
// let a later propagate/removeForecast silently delete or overwrite the date the user
// already recorded.
export function shouldPropagate(entry: PropagationCandidate): boolean {
  return entry.actualCents === null && entry.actualDate === null && !entry.isOverridden;
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
