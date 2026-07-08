// Parses and clamps the Monthly page's URL params (year, month, view) — per spec.md's
// Phase 2 trust boundary note, these cross a trust boundary (attacker-controlled query
// string) and must never propagate a garbage value into a DB query or a Date
// constructor. Every function here falls back to a sane default instead of throwing —
// a malformed URL should render the current month, not 500.

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
    return new Date().getFullYear();
  }
  return n;
}

export function parseMonthParam(raw: RawParam): number {
  const n = Number.parseInt(firstValue(raw) ?? '', 10);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    return new Date().getMonth() + 1;
  }
  return n;
}

export function parseViewParam(raw: RawParam): ViewMode {
  const value = firstValue(raw);
  if (value === 'agenda') return 'agenda';
  if (value === 'list') return 'list';
  return 'calendar';
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
