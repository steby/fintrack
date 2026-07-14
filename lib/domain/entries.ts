import { clampedDueDate } from './reminders';
import { utcDaysBetween } from './today';

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

export type PaidState = 'paid' | 'overdue' | 'upcoming' | 'unscheduled';

export interface PaidStateCandidate {
  actualAmount: string | null;
  // From the linked recurring_schedule row (or null for an ad-hoc entry, or a recurring
  // item with no fixed day) — same "no known due day" shape as
  // lib/domain/affordability.ts's UpcomingEntryCandidate/reminders.ts's
  // UpcomingBillCandidate, kept as its own separate field name (not imported from
  // either) since this classifier is Monthly-view-specific: unlike affordability.ts, it
  // classifies EVERY entry across every month a view happens to render, not just a
  // forward-looking window from "today."
  actualDateDay: number | null;
  year: number;
  month: number;
}

// The ONE paid/overdue/upcoming/unscheduled classifier shared by all three Monthly
// views (calendar, agenda, list — spec.md Phase 10: "paid/upcoming/overdue state
// visible in calendar AND agenda views... mark-paid available in all three"), so the
// three views can never silently disagree about what "overdue" means. Deliberately
// broader than lib/domain/affordability.ts's selectUpcomingItems: that module only ever
// looks at the current + next month within a forward horizon (Home's forecast), while
// this classifies a single entry from WHATEVER month a Monthly-page view happens to be
// showing right now, including past months (an unpaid entry from three months ago is
// still "overdue," not silently reclassified as something else just because it's out of
// affordability.ts's horizon window).
// Direction-aware wording for the one-tap settle flow: "paid" is wrong for income —
// nobody "pays" their own salary. Centralized so the trigger button, confirm sheet,
// and toast can never drift apart. A null direction (uncategorized entry) reads as
// expense wording — the pragmatic default for ad-hoc spends.
export interface EntrySettleLabels {
  action: 'Mark paid' | 'Mark received';
  pending: 'Marking…';
  past: 'paid' | 'received';
  failure: 'Could not mark paid' | 'Could not mark received';
}

export function entrySettleLabels(direction: 'income' | 'expense' | null): EntrySettleLabels {
  if (direction === 'income') {
    return {
      action: 'Mark received',
      pending: 'Marking…',
      past: 'received',
      failure: 'Could not mark received',
    };
  }
  return { action: 'Mark paid', pending: 'Marking…', past: 'paid', failure: 'Could not mark paid' };
}

export function entryPaidState(entry: PaidStateCandidate, today: Date): PaidState {
  // Paid beats everything else, regardless of due day/date — an entry with an actual
  // amount recorded already happened; it can never also be "overdue" or "upcoming."
  if (entry.actualAmount !== null) return 'paid';
  if (entry.actualDateDay === null) return 'unscheduled';

  // Month-end clamping for a configured day that doesn't exist in a shorter month (e.g.
  // day 31 in February) — reminders.ts's exported clampedDueDate is the one shared
  // implementation affordability.ts and this classifier both import, rather than each
  // maintaining its own copy of the same clamp-then-construct-a-Date logic.
  const dueDate = clampedDueDate(entry.year, entry.month, entry.actualDateDay);
  const daysUntilDue = utcDaysBetween(today, dueDate);

  // Due exactly today is "upcoming," not "overdue" (daysUntilDue < 0, not <= 0) — a bill
  // due today hasn't been missed yet. Unlike affordability.ts's selectUpcomingItems,
  // "overdue" here is NOT restricted to the current calendar month: a still-unpaid entry
  // from any past month a view happens to render is just as overdue as one from this
  // month, since this classifier's job is "what does THIS entry look like," not "what
  // belongs in a forward-looking forecast window."
  return daysUntilDue < 0 ? 'overdue' : 'upcoming';
}
