import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  parseAmountToCents,
  centsToAmount,
  InvalidAmountError,
  moneyInputSchema,
  optionalMoneyInputSchema,
} from './money';

describe('parseAmountToCents', () => {
  it('parses whole numbers', () => {
    expect(parseAmountToCents('100')).toBe(10000);
    expect(parseAmountToCents('0')).toBe(0);
  });

  it('parses two-decimal amounts', () => {
    expect(parseAmountToCents('1234.56')).toBe(123456);
    expect(parseAmountToCents('0.01')).toBe(1);
  });

  it('pads a single decimal digit', () => {
    expect(parseAmountToCents('1.5')).toBe(150);
  });

  it('parses negative amounts', () => {
    expect(parseAmountToCents('-12.30')).toBe(-1230);
  });

  it('trims surrounding whitespace', () => {
    expect(parseAmountToCents('  42.00  ')).toBe(4200);
  });

  it.each(['', 'abc', '1.234', '1e5', 'Infinity', 'NaN', '1,234.00', '--5'])(
    'rejects %j as InvalidAmountError',
    (raw) => {
      expect(() => parseAmountToCents(raw)).toThrow(InvalidAmountError);
    },
  );
});

describe('centsToAmount', () => {
  it('formats whole and fractional cents', () => {
    expect(centsToAmount(10000)).toBe('100.00');
    expect(centsToAmount(123456)).toBe('1234.56');
    expect(centsToAmount(1)).toBe('0.01');
    expect(centsToAmount(0)).toBe('0.00');
  });

  it('formats negative cents with a single leading sign', () => {
    expect(centsToAmount(-1230)).toBe('-12.30');
  });

  it('rounds fractional cents (should never occur in practice, but must not throw)', () => {
    expect(centsToAmount(100.6)).toBe('1.01');
  });
});

describe('money round-trip (property)', () => {
  it('parseAmountToCents(centsToAmount(cents)) === cents for any integer cents', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (cents) => {
        expect(parseAmountToCents(centsToAmount(cents))).toBe(cents);
      }),
    );
  });

  it('centsToAmount never throws and always has exactly 2 decimal places', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (cents) => {
        expect(centsToAmount(cents)).toMatch(/^-?\d+\.\d{2}$/);
      }),
    );
  });
});

describe('moneyInputSchema', () => {
  it('accepts a valid non-negative amount', () => {
    expect(moneyInputSchema.parse('12.34')).toBe(1234);
  });

  it('rejects a negative amount (adversarial: negative amounts must not pass the trust boundary)', () => {
    expect(moneyInputSchema.safeParse('-5.00').success).toBe(false);
  });

  it('rejects NaN-shaped input', () => {
    expect(moneyInputSchema.safeParse('NaN').success).toBe(false);
    expect(moneyInputSchema.safeParse('abc').success).toBe(false);
  });
});

describe('optionalMoneyInputSchema', () => {
  it('treats an empty string as null', () => {
    expect(optionalMoneyInputSchema.parse('')).toBeNull();
  });

  it('parses a real amount to cents', () => {
    expect(optionalMoneyInputSchema.parse('9.99')).toBe(999);
  });

  it('still rejects a negative amount', () => {
    expect(optionalMoneyInputSchema.safeParse('-1.00').success).toBe(false);
  });
});
