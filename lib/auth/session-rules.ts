export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function newExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_DURATION_MS);
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

// Sliding expiry, but only worth a DB write once the session is more than halfway
// through its lifetime — renewing on every single request would mean a write per page
// load for no behavioral benefit.
export function shouldRenew(expiresAt: Date, now: Date = new Date()): boolean {
  const remainingMs = expiresAt.getTime() - now.getTime();
  return remainingMs < SESSION_DURATION_MS / 2;
}
