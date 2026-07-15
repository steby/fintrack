import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  FX_RATE_TTL_MS,
  SUPPORTED_FX_CURRENCIES,
  isFxCurrency,
  isFxRateStale,
  convertToSgdCents,
} from './fx-rules';

const NOW = new Date('2026-07-15T12:00:00Z');

describe('isFxCurrency', () => {
  it('accepts every supported currency and rejects everything else', () => {
    for (const c of SUPPORTED_FX_CURRENCIES) expect(isFxCurrency(c)).toBe(true);
    expect(isFxCurrency('SGD')).toBe(false); // base currency is not a *foreign* option
    expect(isFxCurrency('usd')).toBe(false); // case-sensitive by design (zod enum shape)
    expect(isFxCurrency('')).toBe(false);
    expect(isFxCurrency(undefined)).toBe(false);
    expect(isFxCurrency('<script>')).toBe(false);
  });
});

describe('isFxRateStale', () => {
  it('is fresh strictly within the TTL and stale exactly at it', () => {
    expect(isFxRateStale(new Date(NOW.getTime() - FX_RATE_TTL_MS + 1), NOW)).toBe(false);
    expect(isFxRateStale(new Date(NOW.getTime() - FX_RATE_TTL_MS), NOW)).toBe(true);
    expect(isFxRateStale(new Date(NOW.getTime() - FX_RATE_TTL_MS - 1), NOW)).toBe(true);
  });
});

describe('convertToSgdCents', () => {
  it('converts and rounds to the nearest cent', () => {
    expect(convertToSgdCents(2000, 1.3005)).toBe(2601); // US$20.00 @ 1.3005 = S$26.01
    expect(convertToSgdCents(100, 0.0089)).toBe(1); // ¥100 (as 100 units of 1) edge
    expect(convertToSgdCents(0, 1.5)).toBe(0);
  });

  it('always returns a finite integer for any plausible input (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.double({ min: 0.000001, max: 10_000, noNaN: true }),
        (cents, rate) => {
          const out = convertToSgdCents(cents, rate);
          expect(Number.isInteger(out)).toBe(true);
          expect(Number.isFinite(out)).toBe(true);
          expect(out).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
