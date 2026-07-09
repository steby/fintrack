import 'server-only';
import { timingSafeEqual } from 'crypto';
import { env } from '../env';

// Verifies a cron-triggered request (spec.md Phase 6 trust boundary: "cron requests
// (CRON_SECRET bearer check)"). Vercel automatically sends `Authorization: Bearer
// <CRON_SECRET>` when it invokes a scheduled cron job (see vercel.json) — this is the
// server-side check for that header. Fails closed: no CRON_SECRET configured means no
// request can ever be verified, not "verification skipped."
export function verifyCronRequest(request: Request): boolean {
  if (!env.CRON_SECRET) return false;

  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.CRON_SECRET}`;
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);

  // timingSafeEqual throws on mismatched buffer lengths rather than returning false —
  // length-check first so a wrong-length header (the common case: no header at all, or
  // a garbage value) short-circuits without ever reaching the constant-time compare,
  // and so the compare itself never throws.
  if (headerBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(headerBuf, expectedBuf);
}
