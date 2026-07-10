'use server';

import { z } from 'zod';
import { captureException } from '../../lib/observability';

// A Server Action is a public POST endpoint — the (message: string) signature below is
// only a compile-time promise, not a runtime guarantee. Anyone who lifts this action's
// id out of the public error-boundary bundle can POST it directly, bypassing the React
// client and its type-checking entirely — sending a non-string value, or a message
// megabytes long (next.config.ts's Server Actions bodySizeLimit is a GLOBAL 20MB,
// raised for Phase 5's CSV upload, not scoped to this one action). zod enforces the
// real shape at this trust boundary; the length caps bound how much any single report
// can add to logs/Sentry.
const reportClientErrorSchema = z.object({
  message: z.string().max(2000),
  digest: z.string().max(200).optional(),
});

// app/error.tsx is a Client Component (Next.js requires error boundaries to be) so it
// can't import lib/observability.ts directly — that module pulls in pino/node:crypto
// via lib/log.ts, which can't be bundled for the browser. This Server Action is the
// bridge back to the server-side capture seam. Only the message + digest cross the
// boundary (not the Error instance itself) since in production Next redacts
// server-originated error messages down to a digest anyway.
//
// Deliberately NOT behind requireUser()/requireRole(): app/error.tsx is the app's ROOT
// error boundary, reachable from ANY page — including unauthenticated ones like
// /login. Gating this on auth would silently drop reports from exactly the pages most
// likely to need debugging (a broken login page has no session to authenticate with in
// the first place). The zod validation above is this action's real hardening instead.
export async function reportClientError(message: string, digest?: string): Promise<void> {
  const parsed = reportClientErrorSchema.safeParse({ message, digest });
  if (!parsed.success) {
    // A malformed/oversized report is itself a signal worth capturing — as a fixed,
    // safe message, never forwarding the raw unvalidated input.
    await captureException(new Error('reportClientError: received a malformed report'));
    return;
  }
  await captureException(
    new Error(parsed.data.message),
    parsed.data.digest ? { digest: parsed.data.digest } : undefined,
  );
}
