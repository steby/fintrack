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
//
// post-redesign bug-fix pass: Dialog and Drawer are two STRUCTURALLY DIFFERENT
// subtrees, so branching on the live `isDesktop` value on every render means a real
// viewport resize across the 768px breakpoint WHILE a sheet is open (e.g. rotating a
// tablet, or a desktop window dragged narrow) remounts `children` — wiping any
// in-progress form state (a half-filled quick-add form, an in-progress goal edit) with
// no warning. Rare trigger, real bug. Fixed with a surgical, low-risk lock: state (not
// a ref — eslint's react-hooks/refs rule correctly rejects reading ref.current during
// render outside the narrow lazy-init-check idiom) captures `isDesktop`'s value at the
// exact moment `open` transitions from false to true, using the same
// "compare-to-previous-value, adjust state during render" idiom this codebase already
// uses elsewhere for local-only state (e.g. quick-add.tsx/goal-add-form.tsx's
// `reactedTo` pattern) rather than a useEffect (which would run one render late,
// letting that first render briefly use the wrong, unlocked value). Render then uses
// the LOCKED value for the rest of this "open" session instead of the live
// `isDesktop` — a resize mid-session no longer swaps the subtree out from under the
// user. The lock resets (available to be captured fresh) the moment `open` goes back
// to false, so the NEXT time this sheet opens it re-evaluates the viewport fresh, same
// as before this fix. Deliberately NOT a rewrite unifying Dialog/Drawer into one
// shared tree — that's a bigger, riskier change to a primitive used everywhere in this
// app.
function ResponsiveSheet({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
}: ResponsiveSheetProps) {
  const liveIsDesktop = useIsDesktop();

  // Review finding: the breakpoint lock below keys off the open flag, so an
  // UNCONTROLLED usage (trigger-only, no `open` prop — e.g. the net-worth "Learn more"
  // sheet) never engaged it: Dialog/Drawer managed their own hidden open state, and a
  // resize across 768px while open swapped the subtree to the OTHER primitive, whose
  // fresh internal state is `closed` — the sheet silently vanished. Standard
  // controlled/uncontrolled mirror instead: when no `open` prop is passed, this
  // component holds the open state itself and passes it down, so BOTH usages flow
  // through the same `effectiveOpen` and the lock always engages.
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const effectiveOpen = isControlled ? open : uncontrolledOpen;
  const handleOpenChange = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const [lockedIsDesktop, setLockedIsDesktop] = React.useState<boolean | null>(null);
  const [prevOpen, setPrevOpen] = React.useState(effectiveOpen);

  if (effectiveOpen !== prevOpen) {
    setPrevOpen(effectiveOpen);
    // Capture on the false -> true transition; release on the true -> false one, so
    // the NEXT open re-evaluates the viewport fresh instead of reusing a stale lock.
    setLockedIsDesktop(effectiveOpen ? liveIsDesktop : null);
  }

  const isDesktop = effectiveOpen ? (lockedIsDesktop ?? liveIsDesktop) : liveIsDesktop;

  if (isDesktop) {
    return (
      <Dialog open={effectiveOpen} onOpenChange={handleOpenChange}>
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
    <Drawer open={effectiveOpen} onOpenChange={handleOpenChange}>
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
