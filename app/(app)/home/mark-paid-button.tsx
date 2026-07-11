'use client';

import { useTransition } from 'react';
import { markPaidAction, updateActualAction } from '../../actions/monthly';
import { Button } from '@/components/ui/button';
import { useToastManager } from '@/components/ui/toast';
import { formatSGD } from '../../../lib/format';

// One-tap "mark paid" for Home's upcoming list (spec.md Phase 9). Calls markPaidAction
// DIRECTLY (a Server Action invoked as a plain async function inside startTransition,
// not via <form action={...}>/useActionState) and fires the toast from the SAME async
// callback that awaits its result — not from a subsequent render/effect reacting to
// useActionState's returned state.
//
// This is a deliberate, debugged deviation from useActionState (which the plan's own
// WISDOM section sketches for this button): a useActionState-bound version was built
// first and, under real E2E verification, the toast never appeared — root-caused to a
// race between two updates markPaidAction triggers on the SAME response: (1)
// useActionState's own local `state` update, and (2) revalidatePath('/')'s router
// refresh, which removes this exact component from the tree (the entry is no longer
// unpaid, so it drops out of the upcoming list). When both land in one React commit,
// React can go straight from "old tree" to "new tree without this component" without
// ever committing an intermediate frame where THIS instance has the new `state` while
// still mounted — so neither a render-time reaction nor a useEffect keyed on that state
// reliably fires. Calling the action directly and awaiting it removes the dependency on
// this component surviving to observe its own result via a re-render entirely: the toast
// fires the instant the awaited call resolves, in the same closure, regardless of what
// the following revalidation-driven re-render then does to this component's DOM
// position. Undo (below) already used this same direct-call shape for exactly this
// reason — see the plan's own WISDOM note ("an Undo button that calls the undo server
// action") — this just applies the identical, now cross-verified pattern consistently
// to the primary action too instead of only the secondary one.
export function MarkPaidButton({
  entryId,
  item,
  amountCents,
}: {
  entryId: string;
  item: string;
  amountCents: number;
}) {
  const [pending, startTransition] = useTransition();
  const toastManager = useToastManager();

  function handleClick() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set('id', entryId);
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
        description: `${formatSGD(amountCents)} recorded for today.`,
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
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={handleClick}>
      {pending ? 'Marking…' : 'Mark paid'}
    </Button>
  );
}
