import 'server-only';
import { Resend } from 'resend';
import { env } from '../env';
import { logger } from '../log';
import { EMAIL_FROM } from './from-address';

const SEND_TIMEOUT_MS = 5000;

// Same single-attempt-plus-fallback shape as lib/email/invite.ts (see its comment for
// why that's enough for a user-recoverable send — the user can simply request another
// link; reminder/recap-style retries live in resend.ts for sends with no human retry).
export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // Keys-optional: log the link instead of sending — lets the whole flow be
    // exercised in dev/tests/CI without credentials.
    logger.info(
      { email, resetUrl },
      'RESEND_API_KEY not set — logging password reset link instead of emailing it',
    );
    return;
  }

  const resend = new Resend(env.RESEND_API_KEY);

  try {
    const result = await Promise.race([
      resend.emails.send({
        from: EMAIL_FROM,
        to: email,
        subject: 'Reset your FinTrack password',
        html:
          `<p>Someone (hopefully you) asked to reset the password for this FinTrack account.</p>` +
          `<p><a href="${resetUrl}">Choose a new password</a> — this link works once and expires in 1 hour.</p>` +
          `<p>If this wasn't you, you can ignore this email; your password is unchanged.</p>`,
      }),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('Resend request timed out')), SEND_TIMEOUT_MS),
      ),
    ]);
    // The Resend SDK RESOLVES (never rejects) on API-level failures, returning
    // { data: null, error: {...} } — without this check a rate-limited or rejected send
    // looks like success and the user silently never gets a reset link (lib/email/
    // resend.ts's sendOnce does the same check). The catch below keeps the action's
    // response constant either way.
    if (result.error) {
      throw new Error(`Resend API error (${result.error.name}): ${result.error.message}`);
    }
  } catch (err) {
    // The token row already exists; the user can request another link. Never let a
    // flaky provider turn into a thrown error that reveals timing differences to the
    // requester (the action's response must stay constant either way).
    logger.error({ err, email }, 'Failed to send password reset email');
  }
}
