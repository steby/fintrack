'use client';

import { useState, type ComponentProps } from 'react';
import { markPaidAction, updateActualAction } from '../../actions/monthly';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { useToastManager } from '@/components/ui/toast';
import { useAction } from '../../../lib/hooks/use-action';
import { entrySettleLabels } from '../../../lib/domain/entries';
import { formatSGD, formatDueDate } from '../../../lib/format';

// Today in the browser's OWN calendar day, YYYY-MM-DD — a native <input type="date">
// should default to what the user's calendar considers "today," not the server's UTC
// one. Only ever a DEFAULT the user can edit; markPaidAction independently re-defaults
// to UTC today server-side if the field arrives empty.
function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// One-tap settle for Home's upcoming list and all three Monthly views. The trigger
// opens a small ResponsiveSheet confirming the date (defaults to today, editable —
// user's explicit spec: a January bill marked paid in July must be recordable AS
// January).
//
// RACE-SAFETY INVARIANT (canonical explanation — other call sites point here): the
// submission calls the Server Action DIRECTLY via lib/hooks/use-action.ts and fires the
// toast in the SAME awaited closure — never via useActionState + a render/effect
// reacting to returned state. markPaidAction's revalidatePath can unmount this exact
// component (the row leaves the unpaid list) in the same React commit that would have
// delivered the new state, so a state-reactive toast silently never fires — a real bug
// observed under E2E, not a theoretical one. The sheet also closes EAGERLY before the
// await for the same reason: a setOpen(false) after the await relies on this instance
// still being mounted.
export function MarkPaidButton({
  entryId,
  item,
  amountCents,
  direction = null,
  // Cosmetic only — Monthly's table cells / agenda lines need tighter treatments than
  // Home's card rows; the action logic is identical regardless of which view renders it.
  size = 'sm',
  variant = 'outline',
  className,
}: {
  entryId: string;
  item: string;
  amountCents: number;
  direction?: 'income' | 'expense' | null;
  size?: ComponentProps<typeof Button>['size'];
  variant?: ComponentProps<typeof Button>['variant'];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction(markPaidAction);
  const toastManager = useToastManager();
  const labels = entrySettleLabels(direction);

  function handleConfirm(actualDate: string) {
    setOpen(false); // eagerly — see the race-safety comment above
    const formData = new FormData();
    formData.set('id', entryId);
    formData.set('actualDate', actualDate);
    run(formData, (result) => {
      if (!result) return;
      if ('error' in result) {
        toastManager.add({
          type: 'error',
          title: labels.failure,
          description: result.error,
        });
        return;
      }
      if (result.alreadyPaid) return; // idempotent no-op — nothing new to announce

      const previous = result.previous;
      toastManager.add({
        type: 'success',
        title: `Marked "${item}" ${labels.past}`,
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
        {pending ? labels.pending : labels.action}
      </Button>
      <ResponsiveSheet
        open={open}
        onOpenChange={setOpen}
        title={labels.action}
        description={`Confirm the date "${item}" was ${labels.past}.`}
      >
        <MarkPaidForm
          item={item}
          amountCents={amountCents}
          pending={pending}
          actionLabel={labels.action}
          pendingLabel={labels.pending}
          dateLabel={direction === 'income' ? 'Date received' : 'Date paid'}
          onConfirm={handleConfirm}
          onCancel={() => setOpen(false)}
        />
      </ResponsiveSheet>
    </>
  );
}

// `useState(todayLocalIso)` (lazy initializer) computes "today" once per time the sheet
// opens — ResponsiveSheet's children only mount while `open`.
function MarkPaidForm({
  item,
  amountCents,
  pending,
  actionLabel,
  pendingLabel,
  dateLabel,
  onConfirm,
  onCancel,
}: {
  item: string;
  amountCents: number;
  pending: boolean;
  actionLabel: string;
  pendingLabel: string;
  dateLabel: string;
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
        {dateLabel}
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
          {pending ? pendingLabel : actionLabel}
        </Button>
      </div>
    </form>
  );
}
