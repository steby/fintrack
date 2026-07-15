// Pure rules for the FX entry-assist (lib/fx.ts owns the I/O) — DB-free so staleness
// and conversion edge cases are unit-testable, same convention as the other
// *-rules.ts modules.

// 24 hours — the user's own spec: "refreshed whenever, no need to be exact rates".
export const FX_RATE_TTL_MS = 24 * 60 * 60 * 1000;

// Curated set (all supported by frankfurter/ECB): the currencies a Singapore household
// plausibly spends in while travelling, not an exhaustive ISO list.
export const SUPPORTED_FX_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'MYR',
  'IDR',
  'THB',
  'AUD',
  'NZD',
  'CNY',
  'HKD',
  'TWD',
  'KRW',
  'PHP',
  'INR',
  'CHF',
  'CAD',
] as const;

export type FxCurrency = (typeof SUPPORTED_FX_CURRENCIES)[number];

export function isFxCurrency(raw: string | undefined | null): raw is FxCurrency {
  return (SUPPORTED_FX_CURRENCIES as readonly string[]).includes(raw ?? '');
}

export function isFxRateStale(fetchedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - fetchedAt.getTime() >= FX_RATE_TTL_MS;
}

// originalCents * rate, rounded to the nearest SGD cent — plain banker's-free rounding
// (Math.round), matching how a human would eyeball an estimate. Integer-cents in,
// integer-cents out; the caller renders it as an EDITABLE pre-fill, so half-cent
// disagreements with a card statement are expected and fine.
export function convertToSgdCents(originalCents: number, rate: number): number {
  return Math.round(originalCents * rate);
}
