'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { reportClientError } from './actions/report-error';

// The app has no other error boundary — without this, an uncaught throw anywhere in
// the tree (e.g. lib/auth/guards.ts's requireRole rejecting an authorization failure)
// falls through to Next's bare default error UI instead of anything on-brand.
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Fire-and-forget: reportClientError's own captureException() never throws
    // internally, this catch only guards the Server Action round-trip itself (e.g. the
    // client is offline, which is plausible — this boundary can catch network errors).
    reportClientError(error.message, error.digest).catch(() => {});
  }, [error.message, error.digest]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <Button onClick={() => unstable_retry()} variant="outline">
          Try again
        </Button>
      </div>
    </div>
  );
}
