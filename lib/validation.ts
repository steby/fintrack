import { z } from 'zod';
import { isValidCalendarDate } from './domain/month-params';

// Shared zod fragments for Server Action FormData parsing — one definition instead of
// the per-action copies the review found drifting toward (identical `uuidOrEmpty` in
// three files, and goals.ts hand-rolling the same calendar-date round-trip that
// monthly.ts imports from month-params). Lives in lib/ (not app/actions/) because
// 'use server' files may only export async functions.

// Empty string from an unselected <select> means "none" — distinct from a real UUID.
// z.literal('') lets the union accept both without a `|| undefined` dance per call site.
export const uuidOrEmpty = z.union([z.literal(''), z.string().uuid()]).optional();

// Empty string means "no date"; otherwise must be a real YYYY-MM-DD calendar date. The
// regex alone isn't enough — Postgres silently ROLLS OVER an out-of-range day instead
// of rejecting it (e.g. "2026-02-30" becomes 2026-03-02), so a shape-only check would
// let a malformed-but-regex-shaped date land as a different, unintended date.
// isValidCalendarDate (shared with lib/domain/csv.ts's import date coercion) catches
// both totally malformed strings and shape-valid-but-nonexistent dates.
export const dateInputSchema = z.string().refine((v) => {
  if (v === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return isValidCalendarDate(v);
}, 'Enter a valid date (YYYY-MM-DD)');
