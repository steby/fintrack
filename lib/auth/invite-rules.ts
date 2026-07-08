export const INVITE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_DURATION_MS);
}

export interface InvitationLike {
  token: string;
  expiresAt: Date;
  acceptedAt: Date | null;
}

export type InviteValidation =
  { valid: true } | { valid: false; reason: 'token_mismatch' | 'already_accepted' | 'expired' };

// Operates on an already-fetched invitation row (the caller looked it up by id from the
// URL param) plus the token value from that same URL — re-checking the token here
// (rather than trusting the id lookup alone) means a caller that accidentally looks
// invitations up by id without also verifying the token can't be tricked into accepting
// on a guessed/sequential id.
export function validateInvite(
  invitation: InvitationLike,
  submittedToken: string,
  now: Date = new Date(),
): InviteValidation {
  if (invitation.token !== submittedToken) {
    return { valid: false, reason: 'token_mismatch' };
  }
  if (invitation.acceptedAt !== null) {
    return { valid: false, reason: 'already_accepted' };
  }
  if (invitation.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true };
}
