import { describe, expect, it } from 'vitest';
import { newResetExpiry, validateResetToken, RESET_TOKEN_TTL_MS } from './password-reset-rules';

const NOW = new Date('2026-07-15T12:00:00Z');

describe('newResetExpiry', () => {
  it('is exactly the TTL from now', () => {
    expect(newResetExpiry(NOW).getTime()).toBe(NOW.getTime() + RESET_TOKEN_TTL_MS);
  });
});

describe('validateResetToken', () => {
  it('accepts an unused, unexpired token', () => {
    expect(validateResetToken({ expiresAt: newResetExpiry(NOW), usedAt: null }, NOW)).toEqual({
      valid: true,
    });
  });

  it('rejects an expired token', () => {
    expect(
      validateResetToken({ expiresAt: new Date(NOW.getTime() - 1), usedAt: null }, NOW),
    ).toEqual({ valid: false, reason: 'expired' });
  });

  it('expires exactly AT the boundary (not one ms before)', () => {
    expect(validateResetToken({ expiresAt: NOW, usedAt: null }, NOW)).toEqual({
      valid: false,
      reason: 'expired',
    });
    expect(
      validateResetToken({ expiresAt: new Date(NOW.getTime() + 1), usedAt: null }, NOW),
    ).toEqual({ valid: true });
  });

  it('rejects a used token, and "used" wins over "expired" for a stale replay', () => {
    const usedAt = new Date(NOW.getTime() - 1000);
    expect(validateResetToken({ expiresAt: newResetExpiry(NOW), usedAt }, NOW)).toEqual({
      valid: false,
      reason: 'used',
    });
    expect(validateResetToken({ expiresAt: new Date(NOW.getTime() - 1), usedAt }, NOW)).toEqual({
      valid: false,
      reason: 'used',
    });
  });
});
