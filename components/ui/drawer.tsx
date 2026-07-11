'use client';

import * as React from 'react';
import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer';

import { cn } from '@/lib/utils';

// Bottom sheet only (swipeDirection default 'down' is exactly what we want) — BOTH
// Viewport (positioning) and Content (text-selection-vs-swipe) wrappers are required by
// Base UI's Drawer, unlike Radix/Vaul (see the plan's WISDOM note); omitting either one
// silently breaks swipe-to-dismiss or scroll/selection inside the sheet.
const Drawer = DrawerPrimitive.Root;
const DrawerTrigger = DrawerPrimitive.Trigger;
const DrawerClose = DrawerPrimitive.Close;
const DrawerPortal = DrawerPrimitive.Portal;

function DrawerBackdrop({ className, ...props }: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-backdrop"
      className={cn(
        'fixed inset-0 z-50 bg-foreground/30 transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0',
        className,
      )}
      {...props}
    />
  );
}

function DrawerContent({ className, children, ...props }: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPortal>
      <DrawerBackdrop />
      {/* Required positioning flex container (Viewport) — pins the sheet to the bottom
          edge, above BottomNav's fixed position but still inside the safe-area padding
          BottomNav itself accounts for on <main>. */}
      <DrawerPrimitive.Viewport className="fixed inset-x-0 bottom-0 z-50 flex justify-center">
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            'flex max-h-[85vh] w-full max-w-lg flex-col gap-4 rounded-t-2xl border-t bg-card p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-card-foreground shadow-lg outline-none transition-transform duration-300 data-ending-style:translate-y-full data-starting-style:translate-y-full',
            className,
          )}
          {...props}
        >
          <div
            aria-hidden
            className="mx-auto mb-1 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30"
          />
          {/* Required text-selection-vs-swipe wrapper (Content) — without it, selecting
              text inside the sheet with a mouse conflicts with swipe-to-dismiss. */}
          <DrawerPrimitive.Content className="flex flex-1 flex-col gap-4 overflow-y-auto">
            {children}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPortal>
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn('text-base font-semibold', className)}
      {...props}
    />
  );
}

function DrawerDescription({ className, ...props }: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerPortal,
  DrawerBackdrop,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
};
