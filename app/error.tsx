'use client';

import { Button } from '@/components/ui/button';

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
