import { z } from 'zod';

// Postgres numeric(12,2) columns come back from Drizzle as strings (no {mode} set,
// deliberately — a float `mode: 'number'` would reintroduce the exact precision bug
// class this rebuild exists to fix; the original app used SQLite REAL columns). All
// pure domain arithmetic operates on integer cents instead, converting at the DB
// boundary via the two functions below — never via parseFloat/division mid-calculation.

// Matches an optional leading '-', one or more digits, and an optional 1-2 digit
// fractional part — exactly what numeric(12,2) can hold. Deliberately stricter than
// parseFloat (rejects "1e5", "Infinity", trailing garbage, etc). eslint-plugin-security
// flags this as a possible catastrophic-backtracking regex, but its heuristic doesn't
// account for the fact that `\d` and the literal `.` are disjoint character classes with
// no shared characters to backtrack across — this pattern is linear-time for any input.
// eslint-disable-next-line security/detect-unsafe-regex
const NUMERIC_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

export class InvalidAmountError extends Error {
  constructor(raw: string) {
    super(`Not a valid numeric(12,2) amount: ${JSON.stringify(raw)}`);
    this.name = 'InvalidAmountError';
  }
}

// Parses a numeric(12,2)-shaped string into integer cents. Throws InvalidAmountError
// on anything else — callers at trust boundaries (Server Actions) should validate with
// moneyInputSchema (below) first, so this only ever sees already-validated strings or
// values read back from our own DB columns (which are always well-formed by construction).
export function parseAmountToCents(raw: string): number {
  const match = NUMERIC_PATTERN.exec(raw.trim());
  if (!match) {
    throw new InvalidAmountError(raw);
  }
  const [, sign, whole, frac = ''] = match;
  const paddedFrac = frac.padEnd(2, '0');
  const cents = Number(whole) * 100 + Number(paddedFrac);
  return sign === '-' ? -cents : cents;
}

// Inverse of parseAmountToCents — integer cents back to a numeric(12,2)-shaped string
// for storage (e.g. `db.insert(...).values({ budgetedAmount: centsToAmount(cents) })`).
export function centsToAmount(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100);
  const fractional = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${fractional}`;
}

// Trust-boundary schema for a REQUIRED money form field (e.g. a recurring item's
// budgeted amount) — non-negative per spec.md's adversarial pass ("negative/NaN amounts"
// must be rejected). Amounts that are legitimately signed (entry differences) are
// computed internally in cents, never parsed from user input as negative.
export const moneyInputSchema = z
  .string()
  .trim()
  // Same false positive as NUMERIC_PATTERN above: `\d` and the literal `.` never
  // overlap, so there's nothing to backtrack across.
  // eslint-disable-next-line security/detect-unsafe-regex
  .regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid, non-negative amount (up to 2 decimal places)')
  .transform(parseAmountToCents);

// Same, but an empty string means "not provided" (e.g. clearing an actual amount back
// to unfilled) rather than a validation error.
export const optionalMoneyInputSchema = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(moneyInputSchema.nullable());
