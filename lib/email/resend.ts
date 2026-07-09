import 'server-only';
import { Resend } from 'resend';
import { env } from '../env';
import { logger } from '../log';

const SEND_TIMEOUT_MS = 5000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendOnce(resend: Resend, input: SendEmailInput): Promise<unknown> {
  return Promise.race([
    resend.emails.send({ from: 'FinTrack <onboarding@resend.dev>', ...input }),
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error('Resend request timed out')), SEND_TIMEOUT_MS),
    ),
  ]);
}

// Shared low-level sender for Phase 6's reminder/recap emails — 5s timeout + 2 retries
// with a short exponential backoff, then falls back to a structured log line rather
// than throwing (spec.md: "Resend down/timeout (retry w/ backoff, then log + degrade)").
// Keys-optional like lib/email/invite.ts: no RESEND_API_KEY means log-and-return.
// Deliberately a separate, slightly heavier implementation rather than a shared helper
// with invite.ts — that file's own comment already explains why a single
// attempt-plus-fallback is enough there (a low-stakes, owner-recoverable send with a
// manual link fallback); reminder/recap emails have no equivalent human fallback if the
// first attempt fails, so they get real retries.
//
// Returns true when the email was sent (or, keys-optional, logged as a stand-in for
// sending) — false only when a real RESEND_API_KEY is configured and every attempt
// failed. Callers use this to log a distinct "genuinely failed" case; they do NOT use
// it to decide whether to record the dedup ledger row (see api/cron/reminders and
// api/cron/recap route comments for why the ledger claim happens before send).
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    logger.info(
      { to: input.to, subject: input.subject },
      'RESEND_API_KEY not set — logging email instead of sending it',
    );
    return true;
  }

  const resend = new Resend(env.RESEND_API_KEY);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await sendOnce(resend, input);
      return true;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }

  logger.error(
    { err: lastErr, to: input.to, subject: input.subject },
    'Failed to send email after retries; degrading (not sent)',
  );
  return false;
}
