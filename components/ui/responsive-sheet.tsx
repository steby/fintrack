'use client';

import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';

const DESKTOP_QUERY = '(min-width: 768px)';

function subscribe(callback: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

// Hydration-safe "is this a desktop viewport" check via useSyncExternalStore (same
// pattern as components/theme-toggle.tsx's useHasMounted) rather than reading
// matchMedia inside a useEffect + setState, which react-hooks/set-state-in-effect
// correctly flags as cascading-render-prone. The server snapshot defaults to `true`
// (Dialog) rather than rendering nothing — Dialog is the safer of the two to
// flash-render since it has no gesture/swipe state to tear down, per the plan's WISDOM
// note ("render nothing until mounted OR default to Dialog").
function useIsDesktop(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => true);
}

interface ResponsiveSheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactElement;
  title: string;
  description?: string;
  children: React.ReactNode;
}

// Renders a centered Dialog at >= md, a bottom Drawer below it — same content, same
// trigger, the presentation swaps based on viewport. Used for any form/detail surface
// that needs to work identically on desktop and mobile (quick-add, goal edit, generate).
function ResponsiveSheet({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
}: ResponsiveSheetProps) {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {trigger && <DialogTrigger render={trigger} />}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {trigger && <DrawerTrigger render={trigger} />}
      <DrawerContent>
        <DrawerTitle>{title}</DrawerTitle>
        {description && <DrawerDescription>{description}</DrawerDescription>}
        {children}
      </DrawerContent>
    </Drawer>
  );
}

export { ResponsiveSheet };
