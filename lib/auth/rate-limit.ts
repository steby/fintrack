export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export interface AttemptLike {
  attemptedAt: Date;
  success: boolean;
}

// Counts only FAILED attempts within the trailing window — a successful login doesn't
// count against the limit, and failures naturally age out once older than the window
// (no separate cleanup job needed).
export function isRateLimited(attempts: AttemptLike[], now: Date = new Date()): boolean {
  const windowStart = now.getTime() - LOGIN_RATE_LIMIT_WINDOW_MS;
  const recentFailures = attempts.filter(
    (a) => !a.success && a.attemptedAt.getTime() >= windowStart,
  );
  return recentFailures.length >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS;
}
