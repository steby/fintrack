// Shared "what day is it" concept (spec.md Phase 6 pre-decision: the app stays
// UTC-only rather than adding a household-timezone column). Every date-vs-"now"
// comparison in the app — goal overdue (lib/domain/budgeting.ts), upcoming-bill
// selection (lib/domain/reminders.ts) — goes through this pair of functions so there's
// exactly one definition of "today" and "days between," not several ad-hoc ones.

export function utcStartOfDay(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Whole UTC calendar days from `from` to `to` (positive when `to` is later), ignoring
// time-of-day on both — "3 days away" means 3 calendar days, not 72 hours.
export function utcDaysBetween(from: Date, to: Date): number {
  return Math.round((utcStartOfDay(to).getTime() - utcStartOfDay(from).getTime()) / MS_PER_DAY);
}
