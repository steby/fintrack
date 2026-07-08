export type Frequency = 'Monthly' | 'Quarterly' | 'Yearly';

// Defensive parsing: never throws, even on malformed/legacy data (a hand-edited DB row,
// or a schedule_months value written before a future validation tightening). The
// Server Action layer separately validates this field at the trust boundary before it's
// ever stored (see recurringScheduleMonthsSchema in app/actions/recurring.ts) — this is
// a second, independent line of defense for data already at rest, per spec.md's
// adversarial-pass case `schedule_months: "13,0,abc"`. Deduplicates and sorts so
// `shouldGenerate` behaves the same regardless of input ordering/duplication.
export function parseScheduleMonths(raw: string | null): number[] {
  if (!raw) return [];
  const months = new Set<number>();
  for (const part of raw.split(',')) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isInteger(n) && n >= 1 && n <= 12) {
      months.add(n);
    }
  }
  return [...months].sort((a, b) => a - b);
}

// Monthly items generate every month; Quarterly/Yearly only generate in their
// configured months. Ported 1:1 from FinanceTracker's recurring/+page.server.ts
// `generate` action.
export function shouldGenerate(
  frequency: Frequency,
  scheduleMonths: string | null,
  month: number,
): boolean {
  if (frequency === 'Monthly') return true;
  return parseScheduleMonths(scheduleMonths).includes(month);
}

export interface YearMonth {
  year: number;
  month: number;
}

function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a.year - b.year || a.month - b.month;
}

// Inclusive walk from `from` to `to`, one entry per calendar month, correctly crossing
// year boundaries (Dec -> Jan). Never skips or duplicates a month — property-tested.
// Returns [] if `from` is already after `to` (a reversed/invalid range is a no-op, not
// an error — the generate Server Action's own zod schema is where a genuinely malformed
// range gets rejected).
export function walkMonths(from: YearMonth, to: YearMonth): YearMonth[] {
  if (compareYearMonth(from, to) > 0) return [];

  const months: YearMonth[] = [];
  let { year, month } = from;
  while (compareYearMonth({ year, month }, to) <= 0) {
    months.push({ year, month });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return months;
}

// Adds (or, with a negative delta, subtracts) whole calendar months, correctly rolling
// over year boundaries in either direction. Used to compute a rolling "next N months"
// window (e.g. the auto-generate hook's "3 months from today") without hand-rolling
// month-rollover arithmetic at each call site.
export function addMonths(base: YearMonth, delta: number): YearMonth {
  const totalMonths = base.year * 12 + (base.month - 1) + delta;
  return { year: Math.floor(totalMonths / 12), month: (totalMonths % 12) + 1 };
}
