import Link from 'next/link';
import { Button } from '@/components/ui/button';

// Root not-found.tsx catches any unmatched URL app-wide (per Next's file-convention
// docs), not just a notFound() thrown inside a specific route segment — this app has no
// other not-found.tsx, so this is the only one.
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        {/* nativeButton={false}: the render element is an <a> (next/link), not a real
            <button> — Base UI's Button warns loudly (and, in dev, trips the dev overlay)
            if nativeButton stays true while rendering a non-button element. */}
        <Button nativeButton={false} render={<Link href="/" />}>
          Back to Home
        </Button>
      </div>
    </div>
  );
}
