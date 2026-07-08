import { describe, expect, it } from 'vitest';
import {
  isRateLimited,
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  type AttemptLike,
} from './rate-limit';

const now = new Date('2026-01-01T00:00:00Z');

function failuresAt(count: number, msAgo: number): AttemptLike[] {
  return Array.from({ length: count }, () => ({
    attemptedAt: new Date(now.getTime() - msAgo),
    success: false,
  }));
}

describe('isRateLimited', () => {
  it('is false with no attempts at all', () => {
    expect(isRateLimited([], now)).toBe(false);
  });

  it('is false with fewer failures than the max, all within the window', () => {
    expect(isRateLimited(failuresAt(LOGIN_RATE_LIMIT_MAX_ATTEMPTS - 1, 1000), now)).toBe(false);
  });

  it('is true once failures reach the max within the window', () => {
    expect(isRateLimited(failuresAt(LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 1000), now)).toBe(true);
  });

  it('does not count successful attempts against the limit', () => {
    const attempts: AttemptLike[] = Array.from(
      { length: LOGIN_RATE_LIMIT_MAX_ATTEMPTS + 5 },
      () => ({ attemptedAt: new Date(now.getTime() - 1000), success: true }),
    );
    expect(isRateLimited(attempts, now)).toBe(false);
  });

  it('ignores failures older than the window (they age out)', () => {
    const oldFailures = failuresAt(
      LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
      LOGIN_RATE_LIMIT_WINDOW_MS + 1000,
    );
    expect(isRateLimited(oldFailures, now)).toBe(false);
  });

  it('treats the exact window boundary as still within the window (inclusive)', () => {
    const boundaryFailures = failuresAt(LOGIN_RATE_LIMIT_MAX_ATTEMPTS, LOGIN_RATE_LIMIT_WINDOW_MS);
    expect(isRateLimited(boundaryFailures, now)).toBe(true);
  });

  it('mixes old and recent failures, counting only the recent ones toward the limit', () => {
    const attempts = [
      ...failuresAt(LOGIN_RATE_LIMIT_MAX_ATTEMPTS - 1, 1000),
      ...failuresAt(10, LOGIN_RATE_LIMIT_WINDOW_MS + 1000),
    ];
    expect(isRateLimited(attempts, now)).toBe(false);
  });
});
