import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Fixed bottom-right, positioned above BottomNav's fixed bar plus its own safe-area
// padding (same offset math as the toast viewport) — md:hidden because desktop gets a
// header-area "+ Add" button instead. Not mounted anywhere yet: spec.md Phase 10 wires
// this into app/(app)/layout.tsx as the global quick-add trigger; Phase 8 only builds
// the primitive itself.
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
