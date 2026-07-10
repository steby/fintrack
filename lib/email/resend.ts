import 'server-only';
import { randomUUID } from 'crypto';
import { Resend } from 'resend';
import { env } from '../env';
import { logger } from '../log';
import { EMAIL_FROM } from './from-address';

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

async function sendOnce(
  resend: Resend,
  input: SendEmailInput,
  idempotencyKey: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      // Resend's SDK has no AbortSignal support anywhere in its types (checked against
      // the installed version directly — no `signal` field on any request options
      // interface), so a 5s local timeout can't actually cancel the underlying HTTP
      // request; Resend may still finish processing it after we've given up waiting.
      // The SAME idempotencyKey across every retry of this one logical send (passed in
      // by the caller, not generated here) is the real fix for that: it tells Resend's
      // own server "this is a retry of an operation you may have already started,
      // don't send it twice" via the Idempotency-Key header, regardless of whether our
      // side ever learns the first attempt actually succeeded.
      resend.emails.send({ from: EMAIL_FROM, ...input }, { idempotencyKey }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Resend request timed out')), SEND_TIMEOUT_MS);
      }),
    ]);
    // The Resend SDK resolves — never rejects — on API-level failures (bad/restricted
    // key, rate limit, quota exceeded, validation error): it returns
    // { data: null, error: {...} } instead of throwing. Without this check, a real
    // failure here would look identical to a success to every caller below.
    if (result.error) {
      throw new Error(`Resend API error (${result.error.name}): ${result.error.message}`);
    }
  } finally {
    // Clears the pending timeout when the real send settles first, so it doesn't fire
    // ~SEND_TIMEOUT_MS later as a dangling, harmless-but-wasted timer. A no-op if the
    // timeout already fired (that's why we're in the catch path in the first place).
    clearTimeout(timer);
  }
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
  // ONE key for every retry of this logical send, generated once here — not inside
  // sendOnce, which would give each retry its own key and defeat the whole point
  // (Resend would then see N distinct operations instead of N attempts at the same one).
  const idempotencyKey = randomUUID();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await sendOnce(resend, input, idempotencyKey);
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
