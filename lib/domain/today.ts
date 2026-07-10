// Shared "what day is it" concept (spec.md Phase 6 pre-decision: the app stays
// UTC-only rather than adding a household-timezone column). Every date-vs-"now"
// comparison in the app — goal overdue (lib/domain/budgeting.ts), upcoming-bill
// selection (lib/domain/reminders.ts) — goes through this pair of functions so there's
// exactly one definition of "today" and "days between," not several ad-hoc ones.

import type { YearMonth } from './recurring';

export function utcStartOfDay(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Whole UTC calendar days from `from` to `to` (positive when `to` is later), ignoring
// time-of-day on both — "3 days away" means 3 calendar days, not 72 hours.
export function utcDaysBetween(from: Date, to: Date): number {
  return Math.round((utcStartOfDay(to).getTime() - utcStartOfDay(from).getTime()) / MS_PER_DAY);
}

// The UTC-based counterpart for "current year/month" — the cron routes
// (app/api/cron/*) already derived this correctly via getUTCFullYear/getUTCMonth, but
// every SERVER-SIDE call site outside cron (the /monthly auto-generate hook, the
// sidebar year nav, getCurrentMonthCategoryBudgets, the year/month URL-param
// defaults) used plain getFullYear/getMonth instead — local to the RENDERING SERVER's
// timezone, not the household's. Harmless in production (Vercel serverless functions
// run with TZ=UTC), but a real divergence when running locally in a non-UTC timezone,
// and a duplicated "what does 'current month' mean" definition in ~6 places this
// module exists specifically to avoid (same reasoning as utcStartOfDay above). Not
// used for client-side "today" defaults (e.g. the Generate-forecast form's date
// range) — those correctly want the user's OWN browser-local calendar, not UTC.
export function currentYearMonth(now: Date = new Date()): YearMonth {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}
