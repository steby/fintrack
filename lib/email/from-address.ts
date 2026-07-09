// Shared by lib/email/resend.ts and lib/email/invite.ts (deliberately separate senders
// otherwise — see resend.ts's comment) since both send from the same verified domain.
export const EMAIL_FROM = 'FinTrack <fintrack@steby.net>';
