import { describe, expect, it } from 'vitest';
import { newExpiry, isExpired, shouldRenew, SESSION_DURATION_MS } from './session-rules';

describe('newExpiry', () => {
  it('returns a date exactly SESSION_DURATION_MS in the future', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(newExpiry(now).getTime()).toBe(now.getTime() + SESSION_DURATION_MS);
  });
});

describe('isExpired', () => {
  it('is false for an expiry in the future', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const future = new Date(now.getTime() + 1000);
    expect(isExpired(future, now)).toBe(false);
  });

  it('is true for an expiry in the past', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const past = new Date(now.getTime() - 1000);
    expect(isExpired(past, now)).toBe(true);
  });

  it('is true at the exact expiry instant (boundary is inclusive, not exclusive)', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(isExpired(now, now)).toBe(true);
  });
});

describe('shouldRenew', () => {
  it('is false when more than half the session lifetime remains', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS - 1000);
    expect(shouldRenew(expiresAt, now)).toBe(false);
  });

  it('is true once less than half the session lifetime remains', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS / 2 - 1000);
    expect(shouldRenew(expiresAt, now)).toBe(true);
  });

  it('is true for an already-expired session (renewal check runs before the expiry check elsewhere)', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const expiresAt = new Date(now.getTime() - 1000);
    expect(shouldRenew(expiresAt, now)).toBe(true);
  });
});
