// Parses and clamps the Monthly page's URL params (year, month, view) — per spec.md's
// Phase 2 trust boundary note, these cross a trust boundary (attacker-controlled query
// string) and must never propagate a garbage value into a DB query or a Date
// constructor. Every function here falls back to a sane default instead of throwing —
// a malformed URL should render the current month, not 500.

import { currentYearMonth } from './today';
import { addMonths, type YearMonth } from './recurring';

export type ViewMode = 'calendar' | 'agenda' | 'list';

type RawParam = string | string[] | undefined;

function firstValue(raw: RawParam): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

export function parseYearParam(raw: RawParam): number {
  const n = Number.parseInt(firstValue(raw) ?? '', 10);
  if (!Number.isInteger(n) || n < MIN_YEAR || n > MAX_YEAR) {
    return currentYearMonth().year;
  }
  return n;
}

export function parseMonthParam(raw: RawParam): number {
  const n = Number.parseInt(firstValue(raw) ?? '', 10);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    return currentYearMonth().month;
  }
  return n;
}

function isViewMode(value: string | undefined): value is ViewMode {
  return value === 'calendar' || value === 'agenda' || value === 'list';
}

// Phase 10 (spec.md): the URL param wins when present and valid; otherwise a
// `fintrack_view` cookie value is used, IF it's valid; otherwise the default is
// `'agenda'` — this changed from `'calendar'` (Phase 2's original default) because
// there's no way to know a request's viewport server-side, and agenda is the one view
// that reads acceptably at any width without a client round-trip to correct it (a
// desktop user who prefers the calendar grid is one click away, and that choice then
// sticks via the cookie). `cookieValue` is a client-writable trust boundary exactly
// like `raw` (view-toggle.tsx's own comment explains why a plain document.cookie write
// is acceptable for this non-sensitive UI preference) — both are parsed through the
// same `isViewMode` allowlist, so a forged/garbage cookie can never do worse than fall
// back to the documented default, never propagate into a query or crash.
export function parseViewParam(raw: RawParam, cookieValue?: string): ViewMode {
  const value = firstValue(raw);
  if (isViewMode(value)) return value;
  if (isViewMode(cookieValue)) return cookieValue;
  return 'agenda';
}

// Trivial prev/next wrapper around lib/domain/recurring.ts's addMonths (already
// property-tested there for year-boundary correctness in both directions) — exists so
// month-header.tsx doesn't hand-roll its own "month +/- 1, roll over the year" math, and
// so a Dec<->Jan chevron click is provably using the exact same rollover logic the
// generate/auto-generate windows already rely on, not a second, independently-written
// copy of it.
export function monthNav(year: number, month: number): { prev: YearMonth; next: YearMonth } {
  return {
    prev: addMonths({ year, month }, -1),
    next: addMonths({ year, month }, 1),
  };
}

// Shared by app/actions/monthly.ts's dateInputSchema and lib/domain/csv.ts's
// coerceDate — both need to catch calendar-impossible dates (e.g. "2026-02-30") that
// a shape-only YYYY-MM-DD regex would let through. Postgres's own date parsing
// silently ROLLS OVER an out-of-range day instead of rejecting it (2026-02-30 becomes
// 2026-03-02), so a regex-only check would let a malformed-but-shape-valid date land
// as a different, unintended date rather than being rejected. Parsing via Date and
// checking the ISO round-trip matches catches exactly that case. Callers are expected
// to have already confirmed `iso` matches `/^\d{4}-\d{2}-\d{2}$/` — this only checks
// calendar validity, not shape.
export function isValidCalendarDate(iso: string): boolean {
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
}
