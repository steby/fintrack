import { utcDaysBetween } from './today';

// Pure logic for Phase 6's reminder cron — spec.md: "upcoming-bill selection (due in
// ≤3 days from actual_date_day, month-end clamping for day 29-31)". Deliberately
// scoped to *upcoming* bills only (0 to windowDays days away, inclusive) — a bill whose
// due day already passed this month without an actual amount entered is a different
// concern (a stale/overdue forecast row) than "remind me before it's due," and isn't
// covered by this window.

export interface UpcomingBillCandidate {
  id: string;
  item: string;
  year: number;
  month: number;
  // From the linked recurring_schedule row — null means no fixed due day was ever set
  // (or the entry is ad-hoc, with no recurring schedule at all), so it can never be
  // "due" in the date sense this selection needs.
  actualDateDay: number | null;
  // null = not yet paid/entered. A non-null actualAmount means this entry is already
  // settled and shouldn't generate a reminder regardless of its due date.
  actualAmount: string | null;
  budgetedAmount: string;
}

export interface UpcomingBill {
  id: string;
  item: string;
  dueDate: string; // YYYY-MM-DD
  daysUntilDue: number;
  budgetedAmount: string;
}

// Exported: also used by app/(app)/monthly/calendar-view.tsx's identical "clamp a
// scheduled day to the last real day of the month" need (spec.md's "month-end
// clamping for day 29-31" edge case applies the same way in both places), rather than
// each maintaining its own copy of the same one-line calendar computation.
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of `month` — a standard JS Date trick,
  // done here in UTC so it's consistent with utcDaysBetween's UTC-only arithmetic.
  // UTC-vs-local is not actually load-bearing for this specific computation (a pure
  // calendar fact — "Feb 2026 has 28 days" — is timezone-independent either way), but
  // UTC keeps it consistent with the rest of this file's date arithmetic.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Clamps a recurring item's configured day-of-month (e.g. 31) to whatever the target
// month actually has (e.g. 30 in April, 28/29 in February) — spec.md's "month-end
// clamping for day 29-31" edge case. Exported (post-redesign bug-fix pass) so
// lib/domain/affordability.ts and lib/domain/entries.ts's entryPaidState can import
// this single implementation instead of each maintaining its own copy — same
// reasoning as daysInMonth's own export above. This function's own behavior is
// unchanged; only its visibility changed.
export function clampedDueDate(year: number, month: number, day: number): Date {
  const clampedDay = Math.min(day, daysInMonth(year, month));
  return new Date(Date.UTC(year, month - 1, clampedDay));
}

export function selectUpcomingBills(
  candidates: UpcomingBillCandidate[],
  today: Date,
  windowDays = 3,
): UpcomingBill[] {
  const bills: UpcomingBill[] = [];
  for (const candidate of candidates) {
    if (candidate.actualDateDay === null || candidate.actualAmount !== null) continue;

    const dueDate = clampedDueDate(candidate.year, candidate.month, candidate.actualDateDay);
    const daysUntilDue = utcDaysBetween(today, dueDate);
    if (daysUntilDue < 0 || daysUntilDue > windowDays) continue;

    bills.push({
      id: candidate.id,
      item: candidate.item,
      dueDate: dueDate.toISOString().slice(0, 10),
      daysUntilDue,
      budgetedAmount: candidate.budgetedAmount,
    });
  }
  return bills.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}
