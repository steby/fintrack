// Pure validity rules for forgot-password reset tokens (password_reset_tokens rows) —
// kept DB-free so expiry/single-use edge cases are unit-testable, same convention as
// session-rules.ts and invite-rules.ts.

// 60 minutes — a reset link is a live credential sitting in an inbox; unlike an invite
// (7 days) there's no "owner shares it manually" recovery story that needs longevity,
// and the user is actively waiting for the email.
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// Cap on tokens minted per user per TTL window (requestPasswordResetAction) — bounds
// mailbox flooding and token-table growth from a scripted requester without needing
// per-IP tracking; the action's constant response already hides account existence.
export const MAX_ACTIVE_RESET_TOKENS = 3;

export function newResetExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MS);
}

export interface ResetTokenRow {
  expiresAt: Date;
  usedAt: Date | null;
}

export type ResetTokenValidity = { valid: true } | { valid: false; reason: 'expired' | 'used' };

export function validateResetToken(row: ResetTokenRow, now: Date = new Date()): ResetTokenValidity {
  // Used beats expired — a replayed link should always read as "already used", never
  // downgrade to "expired" once the TTL passes (clearer signal if a user reports it).
  if (row.usedAt !== null) return { valid: false, reason: 'used' };
  if (row.expiresAt.getTime() <= now.getTime()) return { valid: false, reason: 'expired' };
  return { valid: true };
}
