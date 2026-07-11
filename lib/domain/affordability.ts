import { daysInMonth } from './reminders';
import { utcDaysBetween, utcStartOfDay, currentYearMonth } from './today';
import { parseAmountToCents } from '../money';

// Pure logic for Phase 9's forecast-first Home — spec.md: "Home answers 'Can I cover
// what's coming?'; safe-to-spend = both lenses (projected cash primary, budget-remaining
// secondary), expenses-only subtraction (expected income = secondary info, but IS
// included in the runway projection)". A superset of lib/domain/reminders.ts's
// UpcomingBillCandidate/UpcomingBill (this module's own UpcomingEntryCandidate/
// UpcomingItem cover ad-hoc entries and both directions, not just fixed-day expense
// bills within a 3-day cron window) — reminders.ts itself is NOT touched or reused by
// this file beyond importing its pure, side-effect-free daysInMonth helper; the cron
// email path keeps its own, narrower selection logic untouched (see
// app/actions/monthly.integration.test.ts's "reminders freeze" test, which guards this).

export interface UpcomingEntryCandidate {
  id: string;
  item: string;
  year: number;
  month: number;
  // From the linked recurring_schedule row — null means either an ad-hoc entry (no
  // recurring_schedule_id at all) or a recurring item that never got a fixed due day.
  // Either way, "no known due day" is handled the same: due at the (clamped) end of its
  // own (year, month), not excluded outright the way reminders.ts's UpcomingBillCandidate
  // excludes it (that module only cares about bills with a real due DATE to count down
  // to within a 3-day window; this module's job is "what's coming, roughly when," which
  // still wants an ad-hoc grocery entry to show up somewhere on the list).
  actualDateDay: number | null;
  // null = not yet paid/entered — a non-null actualAmount means this entry is already
  // settled and must never appear in the upcoming list or reduce safe-to-spend twice
  // (it already left the account; getActualizedCashRows' cash figure already reflects it).
  actualAmount: string | null;
  budgetedAmount: string;
  // null = uncategorized. Direction is what tells this module whether an entry adds to
  // or subtracts from cash — an uncategorized row can't be classified either way, so
  // it's skipped entirely (same convention as lib/domain/dashboard.ts's row shape).
  direction: 'income' | 'expense' | null;
  categoryName: string | null;
  categoryColor: string | null;
}

export interface UpcomingItem {
  entryId: string;
  item: string;
  dueDate: string; // YYYY-MM-DD
  // Negative = overdue (only possible for a CURRENT-month entry — see selectUpcomingItems).
  daysUntilDue: number;
  amountCents: number;
  direction: 'income' | 'expense';
  // false = no fixed due day existed (ad-hoc entry, or a recurring item with no
  // actual_date_day set) — its dueDate is a month-end estimate, not a real commitment.
  scheduled: boolean;
  overdue: boolean;
  categoryName: string | null;
  categoryColor: string | null;
}

export type Horizon = 'month' | 7 | 14 | 30;

// Trust-boundary parser (spec.md Phase 9 trust boundary: "horizon re-validated on read")
// for both the setHorizonAction form field AND a `household_settings` row read back off
// the DB — a hand-edited or stale row is exactly as untrusted as a forged form post, so
// this is the ONE place either input is turned into a Horizon. Anything not exactly one
// of the four accepted shapes (including a numeric-LOOKING but out-of-set value like
// '9999', or a blank/missing/null value) falls back to the documented default, never throws.
export function parseHorizon(raw: string | null | undefined): Horizon {
  if (raw === '7') return 7;
  if (raw === '14') return 14;
  if (raw === '30') return 30;
  return 'month';
}

// Days from `today` (inclusive of today, i.e. a 0-based count) to the end of `today`'s
// own calendar month for the 'month' horizon; the fixed literal itself for 7/14/30. On
// the 1st of a 31-day month this is 30 (today + the following 30 days reaches the 31st);
// on the LAST day of a month it's 0 (the window is just today) — a real edge case this
// spec.md Phase 9 explicitly calls out ("'month' horizon on the 1st vs the last day of a
// month"), not an off-by-one accident.
export function resolveHorizonDays(h: Horizon, today: Date): number {
  if (h !== 'month') return h;
  const start = utcStartOfDay(today);
  return daysInMonth(start.getUTCFullYear(), start.getUTCMonth() + 1) - start.getUTCDate();
}

// Mirrors reminders.ts's private clampedDueDate (day 29-31 clamping for short months) —
// duplicated rather than imported because reminders.ts doesn't export it and this file
// must not modify reminders.ts (spec.md Phase 9: the cron email path stays untouched).
function clampedDueDate(year: number, month: number, day: number): Date {
  const clampedDay = Math.min(day, daysInMonth(year, month));
  return new Date(Date.UTC(year, month - 1, clampedDay));
}

// Selects and shapes every candidate worth showing on Home's upcoming list within
// [0, horizonDays] days from today, PLUS any current-month overdue unpaid expense
// regardless of horizon (an overdue bill must never silently drop off the list just
// because a household narrowed their horizon to 7 days — see computeSafeToSpend, which
// always subtracts overdue expenses no matter which horizon produced this array).
export function selectUpcomingItems(
  candidates: UpcomingEntryCandidate[],
  today: Date,
  horizonDays: number,
): UpcomingItem[] {
  const current = currentYearMonth(today);
  const items: UpcomingItem[] = [];

  for (const candidate of candidates) {
    if (candidate.actualAmount !== null) continue; // already paid
    if (candidate.direction === null) continue; // uncategorized — can't sign it

    const scheduled = candidate.actualDateDay !== null;
    // Unscheduled (no fixed due day) -> due at the clamped end of its own month, per
    // spec.md Phase 9 task 1's UpcomingItem contract.
    const day = candidate.actualDateDay ?? daysInMonth(candidate.year, candidate.month);
    const dueDate = clampedDueDate(candidate.year, candidate.month, day);
    const daysUntilDue = utcDaysBetween(today, dueDate);

    const isCurrentMonth = candidate.year === current.year && candidate.month === current.month;
    const overdue = daysUntilDue < 0 && isCurrentMonth;

    if (!overdue && (daysUntilDue < 0 || daysUntilDue > horizonDays)) continue;

    items.push({
      entryId: candidate.id,
      item: candidate.item,
      dueDate: dueDate.toISOString().slice(0, 10),
      daysUntilDue,
      amountCents: parseAmountToCents(candidate.budgetedAmount),
      direction: candidate.direction,
      scheduled,
      overdue,
      categoryName: candidate.categoryName,
      categoryColor: candidate.categoryColor,
    });
  }

  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.item.localeCompare(b.item));
}

export interface SafeToSpend {
  currentCashCents: number;
  upcomingExpenseCents: number;
  overdueExpenseCents: number;
  expectedIncomeCents: number;
  safeToSpendCents: number;
}

// safeToSpend = cash − upcoming expenses − overdue expenses. Expected income is reported
// separately but deliberately NOT added back (user decision, spec.md: "expenses-only
// subtraction ... expected income = secondary info") — a conservative number that never
// gets more optimistic just because a paycheck is forecast but hasn't landed yet.
export function computeSafeToSpend(currentCashCents: number, items: UpcomingItem[]): SafeToSpend {
  let upcomingExpenseCents = 0;
  let overdueExpenseCents = 0;
  let expectedIncomeCents = 0;

  for (const item of items) {
    if (item.direction === 'expense') {
      if (item.overdue) overdueExpenseCents += item.amountCents;
      else upcomingExpenseCents += item.amountCents;
    } else {
      expectedIncomeCents += item.amountCents;
    }
  }

  return {
    currentCashCents,
    upcomingExpenseCents,
    overdueExpenseCents,
    expectedIncomeCents,
    safeToSpendCents: currentCashCents - upcomingExpenseCents - overdueExpenseCents,
  };
}

export interface BudgetRemaining {
  budgetedExpenseCents: number;
  spentExpenseCents: number;
  remainingCents: number;
  pctSpent: number;
}

// The Home hero's secondary "budget left this month" lens — total budgeted expense for
// the month minus what's ACTUALLY been spent so far (actualCents only, never falling
// back to budgeted like lib/domain/dashboard.ts's bestEstimateCents does elsewhere): an
// unpaid forecast row hasn't spent anything yet, so counting its budgeted amount as
// "spent" would make this number permanently read $0 remaining the moment a month is
// fully forecast, defeating the whole point of the lens. Deliberately independent of any
// per-category cap (lib/domain/budgeting.ts's computeBudgetProgress) — this is a single
// household-wide total, not a per-category health check.
export function computeBudgetRemaining(
  entries: {
    direction: 'income' | 'expense' | null;
    budgetedCents: number;
    actualCents: number | null;
  }[],
): BudgetRemaining {
  let budgetedExpenseCents = 0;
  let spentExpenseCents = 0;

  for (const entry of entries) {
    if (entry.direction !== 'expense') continue;
    budgetedExpenseCents += entry.budgetedCents;
    spentExpenseCents += entry.actualCents ?? 0;
  }

  return {
    budgetedExpenseCents,
    spentExpenseCents,
    remainingCents: budgetedExpenseCents - spentExpenseCents,
    // 0, not NaN/Infinity, when nothing is budgeted at all — same "no baseline, don't
    // show garbage" convention as lib/domain/dashboard.ts's percentDelta.
    pctSpent: budgetedExpenseCents === 0 ? 0 : (spentExpenseCents / budgetedExpenseCents) * 100,
  };
}

export interface RunwayPoint {
  date: string; // YYYY-MM-DD
  projectedCashCents: number;
}

// Day-by-day projected cash from today through the horizon (inclusive both ends ->
// horizonDays + 1 points) — UNLIKE computeSafeToSpend, this DOES include income (spec.md
// Phase 9: "runway DOES include income — document the hero/runway asymmetry"). The hero
// number is deliberately conservative (never assumes a paycheck arrives); the sparkline
// is deliberately a full projection (it's meant to show the shape of the month, including
// the bounce-back after payday), and showing two different philosophies side by side on
// the same screen without this comment would look like a bug to a future reader.
export function buildRunway(
  currentCashCents: number,
  items: UpcomingItem[],
  today: Date,
  horizonDays: number,
): RunwayPoint[] {
  const start = utcStartOfDay(today);
  const deltaByOffset = new Map<number, number>();

  for (const item of items) {
    const signed = item.direction === 'income' ? item.amountCents : -item.amountCents;
    // Overdue items land on day 0 regardless of how far in the past their real due date
    // was (spec.md: "overdue applied at day 0"). Clamped into [0, horizonDays] for every
    // other item too — defensive against a caller passing an item outside the horizon
    // it computed horizonDays from (this function has no way to re-derive that on its
    // own), so a day-count mismatch loses a delta silently rather than the running total
    // simply never reflecting it in the visible series.
    const offset = item.overdue ? 0 : Math.min(Math.max(item.daysUntilDue, 0), horizonDays);
    deltaByOffset.set(offset, (deltaByOffset.get(offset) ?? 0) + signed);
  }

  const points: RunwayPoint[] = [];
  let running = currentCashCents;
  for (let offset = 0; offset <= horizonDays; offset++) {
    running += deltaByOffset.get(offset) ?? 0;
    const date = new Date(start.getTime() + offset * 86_400_000);
    points.push({ date: date.toISOString().slice(0, 10), projectedCashCents: running });
  }
  return points;
}
