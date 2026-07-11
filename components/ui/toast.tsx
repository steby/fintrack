'use client';

import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

// Mount ToastProvider once, near the app root (app/layout.tsx, inside ThemeProvider) —
// every toast fired anywhere in the app renders into the one <Toaster/> viewport it
// wraps. limit/timeout match the plan's defaults exactly (also Base UI's own defaults;
// spelled out here so a future edit changing them is a deliberate, visible diff).
function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <ToastPrimitive.Provider limit={3} timeout={5000}>
      {children}
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport
          data-slot="toast-viewport"
          className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom)+0.75rem)] z-50 mx-auto flex w-[calc(100vw-2rem)] max-w-sm flex-col items-end gap-2 md:right-4 md:bottom-4 md:left-auto md:inset-x-auto"
        >
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}

// useToastManager() must be called from a descendant of Toast.Provider, not the
// Provider's own body — split into its own component rather than inlining in
// ToastProvider above.
function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();
  return toasts.map((toast) => (
    <ToastPrimitive.Root
      key={toast.id}
      toast={toast}
      data-slot="toast"
      className={cn(
        'relative w-full rounded-xl border bg-card p-4 text-card-foreground shadow-lg transition-all duration-300',
        'data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0',
        'data-[type=error]:border-expense/40 data-[type=success]:border-income/40',
      )}
    >
      <ToastPrimitive.Content data-slot="toast-content" className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <ToastPrimitive.Title data-slot="toast-title" className="text-sm font-semibold" />
            <ToastPrimitive.Description
              data-slot="toast-description"
              className="text-sm text-muted-foreground"
            />
          </div>
          <ToastPrimitive.Close
            data-slot="toast-close"
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-1 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <XIcon className="size-4" />
          </ToastPrimitive.Close>
        </div>
        {/* Renders nothing when the toast has no actionProps (reads from the ancestor
            Toast.Root's `toast` prop, not passed explicitly here) — always mounted,
            matching Base UI's own documented pattern, not conditionally wrapped. */}
        <ToastPrimitive.Action
          data-slot="toast-action"
          className="self-start rounded-md text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </ToastPrimitive.Content>
    </ToastPrimitive.Root>
  ));
}

const useToastManager = ToastPrimitive.useToastManager;

export { ToastProvider, useToastManager };
