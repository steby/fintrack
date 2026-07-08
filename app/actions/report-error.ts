'use server';

import { captureException } from '../../lib/observability';

// app/error.tsx is a Client Component (Next.js requires error boundaries to be) so it
// can't import lib/observability.ts directly — that module pulls in pino/node:crypto
// via lib/log.ts, which can't be bundled for the browser. This Server Action is the
// bridge back to the server-side capture seam. Only the message + digest cross the
// boundary (not the Error instance itself) since in production Next redacts
// server-originated error messages down to a digest anyway.
export async function reportClientError(message: string, digest?: string): Promise<void> {
  await captureException(new Error(message), digest ? { digest } : undefined);
}
