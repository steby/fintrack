import 'server-only';
import { Resend } from 'resend';
import { env } from '../env';
import { logger } from '../log';
import { EMAIL_FROM } from './from-address';

const SEND_TIMEOUT_MS = 5000;

export async function sendInviteEmail(email: string, acceptUrl: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // Keys-optional: no Resend key configured, so log the accept URL instead of
    // sending — lets the invite flow be fully exercised (dev, tests, CI) without real
    // credentials, and lets the household owner just copy the link manually.
    logger.info(
      { email, acceptUrl },
      'RESEND_API_KEY not set — logging invite link instead of emailing it',
    );
    return;
  }

  const resend = new Resend(env.RESEND_API_KEY);

  try {
    await Promise.race([
      resend.emails.send({
        from: EMAIL_FROM,
        to: email,
        subject: "You've been invited to a FinTrack household",
        html: `<p>You've been invited to join a household on FinTrack.</p><p><a href="${acceptUrl}">Accept invite</a></p>`,
      }),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('Resend request timed out')), SEND_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    // Never let a flaky email provider block invite creation — the invite row already
    // exists, and the owner can always share acceptUrl manually. Full retry-with-backoff
    // lands in Phase 6 alongside the dedup ledger for reminder/recap emails; this is a
    // single-attempt-plus-fallback, which is enough for a low-stakes, owner-recoverable
    // send.
    logger.error({ err, email }, 'Failed to send invite email; invite was still created');
  }
}
