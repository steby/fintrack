import type { ComponentType, ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface InlineNoteProps {
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}

// A small explanatory note about why part (or all) of a page is unavailable — e.g. a
// config flag or runtime kill-switch is off. Extracted from accounts/page.tsx's
// FEATURE_NET_WORTH-off note (Phase 8) and import/page.tsx's csv_import-off note
// (Phase 5), which had drifted into two different hand-rolled <p> shapes for the same
// idea. Deliberately NOT shared with goals/page.tsx's or the Home hero's feature-off
// copy — those are structurally different degradation patterns (plain header-copy
// swap, and an inline CTA link respectively), not this icon-plus-note shape.
function InlineNote({ icon: Icon, children, className }: InlineNoteProps) {
  return (
    <p
      data-slot="inline-note"
      className={cn('flex max-w-xl items-center gap-2 text-sm text-muted-foreground', className)}
    >
      {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
      {children}
    </p>
  );
}

export { InlineNote };
