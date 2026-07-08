import { describe, expect, it } from 'vitest';
import {
  validateInvite,
  inviteExpiry,
  INVITE_DURATION_MS,
  type InvitationLike,
} from './invite-rules';

const now = new Date('2026-01-01T00:00:00Z');

function makeInvitation(overrides: Partial<InvitationLike> = {}): InvitationLike {
  return {
    token: 'the-real-token',
    expiresAt: new Date(now.getTime() + 1000),
    acceptedAt: null,
    ...overrides,
  };
}

describe('inviteExpiry', () => {
  it('returns a date exactly INVITE_DURATION_MS in the future', () => {
    expect(inviteExpiry(now).getTime()).toBe(now.getTime() + INVITE_DURATION_MS);
  });
});

describe('validateInvite', () => {
  it('is valid for a fresh, unaccepted, unexpired invitation with the matching token', () => {
    expect(validateInvite(makeInvitation(), 'the-real-token', now)).toEqual({ valid: true });
  });

  it('rejects a mismatched token even if the row itself is otherwise valid', () => {
    expect(validateInvite(makeInvitation(), 'a-guessed-token', now)).toEqual({
      valid: false,
      reason: 'token_mismatch',
    });
  });

  it('rejects an already-accepted invitation (replay)', () => {
    const invitation = makeInvitation({ acceptedAt: new Date(now.getTime() - 1000) });
    expect(validateInvite(invitation, 'the-real-token', now)).toEqual({
      valid: false,
      reason: 'already_accepted',
    });
  });

  it('rejects an expired invitation', () => {
    const invitation = makeInvitation({ expiresAt: new Date(now.getTime() - 1000) });
    expect(validateInvite(invitation, 'the-real-token', now)).toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('treats the exact expiry instant as expired (boundary is inclusive)', () => {
    const invitation = makeInvitation({ expiresAt: now });
    expect(validateInvite(invitation, 'the-real-token', now)).toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('checks token match before accepted/expired state, so a wrong-token guess never leaks whether the invite was already used', () => {
    const invitation = makeInvitation({
      acceptedAt: new Date(now.getTime() - 1000),
      expiresAt: new Date(now.getTime() - 1000),
    });
    expect(validateInvite(invitation, 'a-guessed-token', now)).toEqual({
      valid: false,
      reason: 'token_mismatch',
    });
  });
});
