import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Fixed bottom-right, positioned above BottomNav's fixed bar plus its own safe-area
// padding (same offset math as the toast viewport) — md:hidden because desktop gets the
// sidebar's "New entry" button instead. LIVE on every authed page: this is the mobile
// global quick-add trigger, mounted via app/(app)/quick-add.tsx from the app layout
// (Phase 10 wired it in; an earlier comment here still said "not mounted anywhere yet"
// — review finding).
function Fab({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      size="icon-lg"
      className={cn(
        'fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom)+0.75rem)] z-20 rounded-full shadow-lg md:hidden',
        className,
      )}
      {...props}
    />
  );
}

export { Fab };
