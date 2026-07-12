'use client';

import { useState, useTransition, type ComponentProps } from 'react';
import { markPaidAction, updateActualAction } from '../../actions/monthly';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { useToastManager } from '@/components/ui/toast';
import { formatSGD, formatDueDate } from '../../../lib/format';

// Today in the browser's OWN calendar day, YYYY-MM-DD — matches
// app/(app)/recurring/generate-form.tsx's own established precedent of a client-side
// form default being deliberately browser-local (a native <input type="date"> should
// default to what the user's own calendar considers "today," not the server's UTC
// canonical one). This is only ever a DEFAULT the user can edit before confirming;
// markPaidAction independently re-defaults to its own UTC "today" server-side if this
// field is ever empty/stripped (defense in depth, not a source of truth mismatch).
function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Mark paid for Home's upcoming list, Monthly's calendar/agenda/list views (spec.md
// Phase 9-10). Clicking "Mark paid" opens a small ResponsiveSheet confirming the date
// (post-redesign bug-fix pass — USER'S EXPLICIT SPEC: markPaidAction used to hardcode
// actualDate to today regardless of which month the entry actually belongs to, which
// broke the moment Phase 10 made this button reachable from arbitrary past/future
// months via Monthly's chevrons; a January bill marked paid in July should be
// recordable AS January, not today) — defaulting to today but fully editable, with
// Cancel/"Mark paid" actions. The date field is the ONLY new input; everything below
// about HOW the actual submission is fired is unchanged from before this fix.
//
// The submission itself still calls markPaidAction DIRECTLY (a Server Action invoked
// as a plain async function inside startTransition, not via <form action={...}>/
// useActionState) and fires the toast from the SAME async callback that awaits its
// result — not from a subsequent render/effect reacting to useActionState's returned
// state. This is a deliberate, debugged deviation from useActionState (which the
// original Phase 9 plan's own WISDOM section sketched for this button): a
// useActionState-bound version was built first and, under real E2E verification, the
// toast never appeared — root-caused to a race between two updates markPaidAction
// triggers on the SAME response: (1) useActionState's own local `state` update, and
// (2) revalidatePath('/')'s router refresh, which removes this exact component from
// the tree (the entry is no longer unpaid, so it drops out of the upcoming list). When
// both land in one React commit, React can go straight from "old tree" to "new tree
// without this component" without ever committing an intermediate frame where THIS
// instance has the new `state` while still mounted — so neither a render-time reaction
// nor a useEffect keyed on that state reliably fires. Calling the action directly and
// awaiting it removes the dependency on this component surviving to observe its own
// result via a re-render entirely: the toast fires the instant the awaited call
// resolves, in the same closure, regardless of what the following revalidation-driven
// re-render then does to this component's DOM position. The popup's own open/close
// state is a SEPARATE, purely local concern (closed eagerly the moment the user
// confirms, before the action is even awaited — see handleConfirm below) and doesn't
// change this invariant at all: Undo already used this same direct-call shape for
// exactly this reason — see the plan's own WISDOM note ("an Undo button that calls the
// undo server action") — this just applies the identical, now cross-verified pattern
// consistently to the primary action too instead of only the secondary one.
export function MarkPaidButton({
  entryId,
  item,
  amountCents,
  // Phase 10: Monthly's calendar/agenda/list views reuse this exact component (per the
  // plan's own instruction — "do NOT rebuild it with useActionState") but need a more
  // compact visual treatment than Home's upcoming-list row (a table cell, an agenda
  // line, a day-sheet list item — all tighter spaces than Home's card). Purely
  // cosmetic — every prop below only reaches the underlying trigger Button's
  // className/variant/size; the startTransition/toast logic is untouched and always
  // runs the same way regardless of which view rendered this instance.
  size = 'sm',
  variant = 'outline',
  className,
}: {
  entryId: string;
  item: string;
  amountCents: number;
  size?: ComponentProps<typeof Button>['size'];
  variant?: ComponentProps<typeof Button>['variant'];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const toastManager = useToastManager();

  function handleConfirm(actualDate: string) {
    // Close eagerly, before the action is even awaited — this component (or its
    // ancestor day-sheet row) may unmount once markPaidAction's revalidatePath lands,
    // so a setOpen(false) placed AFTER the await would be relying on this instance
    // still being mounted to apply it. Closing first sidesteps that entirely; the
    // trigger Button below still shows its own "Marking…" pending state in the
    // meantime for feedback if it's still on screen.
    setOpen(false);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('id', entryId);
      formData.set('actualDate', actualDate);
      const result = await markPaidAction(undefined, formData);

      if (!result) return;
      if ('error' in result) {
        toastManager.add({
          type: 'error',
          title: 'Could not mark paid',
          description: result.error,
        });
        return;
      }
      if (result.alreadyPaid) return; // idempotent no-op — nothing new to announce

      const previous = result.previous;
      toastManager.add({
        type: 'success',
        title: `Marked "${item}" paid`,
        description: `${formatSGD(amountCents)} recorded for ${formatDueDate(actualDate)}.`,
        actionProps: {
          children: 'Undo',
          onClick: () => {
            const undoFormData = new FormData();
            undoFormData.set('id', entryId);
            undoFormData.set('actualAmount', previous.actualAmount ?? '');
            undoFormData.set('actualDate', previous.actualDate ?? '');
            void updateActualAction(undefined, undoFormData);
          },
        },
      });
    });
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        {pending ? 'Marking…' : 'Mark paid'}
      </Button>
      <ResponsiveSheet
        open={open}
        onOpenChange={setOpen}
        title="Mark paid"
        description={`Confirm the date "${item}" was actually paid.`}
      >
        <MarkPaidForm
          item={item}
          amountCents={amountCents}
          pending={pending}
          onConfirm={handleConfirm}
          onCancel={() => setOpen(false)}
        />
      </ResponsiveSheet>
    </>
  );
}

// The popup's own body — item name as read-only context, an editable date field
// defaulting to today, Cancel + Mark paid. `useState(todayLocalIso)` (a lazy
// initializer, not `useState(todayLocalIso())`) computes "today" once per mount, i.e.
// once per time the sheet opens (ResponsiveSheet's children only actually mount while
// `open` — Base UI's own documented behavior), not once per app load.
function MarkPaidForm({
  item,
  amountCents,
  pending,
  onConfirm,
  onCancel,
}: {
  item: string;
  amountCents: number;
  pending: boolean;
  onConfirm: (actualDate: string) => void;
  onCancel: () => void;
}) {
  const [actualDate, setActualDate] = useState(todayLocalIso);

  return (
    <form
      data-testid="mark-paid-form"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(actualDate);
      }}
    >
      <div className="flex flex-col gap-0.5 rounded-lg border border-border/60 px-3 py-2">
        <span className="text-sm font-medium">{item}</span>
        <span className="text-sm text-muted-foreground">{formatSGD(amountCents)}</span>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Date paid
        <Input
          type="date"
          name="actualDate"
          value={actualDate}
          onChange={(e) => setActualDate(e.target.value)}
          required
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Marking…' : 'Mark paid'}
        </Button>
      </div>
    </form>
  );
}
