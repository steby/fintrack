import { describe, expect, it } from 'vitest';
import { formatSGD, formatSGDCompact } from './format';

describe('formatSGD', () => {
  it('formats positive cents as SGD', () => {
    expect(formatSGD(123456)).toBe('$1,234.56');
  });

  it('formats zero', () => {
    expect(formatSGD(0)).toBe('$0.00');
  });

  it('formats negative cents', () => {
    expect(formatSGD(-500)).toBe('-$5.00');
  });

  it("never renders a USD sign or hardcoded $ literal without the SGD formatter (regression guard for the original app's currency bug)", () => {
    // en-SG's SGD symbol renders as "$", identical glyph to USD — this test exists to
    // catch a future accidental swap to `currency: 'USD'`/`locale: 'en-US'`, not to
    // assert a visibly different symbol (Intl doesn't disambiguate SGD/USD by symbol).
    expect(formatSGD(100)).toBe('$1.00');
  });
});

describe('formatSGDCompact', () => {
  it('formats sub-thousand amounts as whole dollars', () => {
    expect(formatSGDCompact(45000)).toBe('$450');
  });

  it('formats amounts >= 100,000 cents ($1,000) with a k suffix', () => {
    expect(formatSGDCompact(150_000)).toBe('$1.5k');
  });

  it('formats negative compact amounts', () => {
    expect(formatSGDCompact(-45000)).toBe('-$450');
  });

  it('formats zero', () => {
    expect(formatSGDCompact(0)).toBe('$0');
  });
});
