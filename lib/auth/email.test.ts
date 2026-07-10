import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './email';

describe('normalizeEmail', () => {
  it('lowercases the entire address', () => {
    expect(normalizeEmail('Bob@Gmail.com')).toBe('bob@gmail.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  bob@gmail.com  ')).toBe('bob@gmail.com');
  });

  it('is idempotent — normalizing an already-normalized email is a no-op', () => {
    expect(normalizeEmail(normalizeEmail('Bob@Gmail.com'))).toBe(normalizeEmail('Bob@Gmail.com'));
  });

  it('leaves an already-lowercase email unchanged', () => {
    expect(normalizeEmail('bob@gmail.com')).toBe('bob@gmail.com');
  });

  it('two differently-cased inputs for the same mailbox normalize to the same value (the actual bug this exists to close)', () => {
    expect(normalizeEmail('Bob@Gmail.com')).toBe(normalizeEmail('bob@gmail.com'));
  });
});
