'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { updateEntryDetailsAction } from '../actions/monthly';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { useToastManager } from '@/components/ui/toast';
import { useAction } from '../../lib/hooks/use-action';
import { useQuickAddOpen } from './quick-add-context';

export interface EditableEntry {
  id: string;
  item: string;
  categoryId: string | null;
  actualAmount: string | null;
  actualDate: string | null;
  // Recurring-generated rows can't be renamed here (the name belongs to the Plan
  // template; updateEntryDetailsAction enforces this server-side too).
  recurringLinked: boolean;
}

// Per-row edit affordance (full-app-review finding N1: ad-hoc entries had no edit path
// at all after creation — not even to assign a category, making the categorize nudge a
// dead end). One pencil per row rather than tap-the-row: rows already contain their own
// buttons (Mark paid/received, Delete), and a row-as-button wrapper would nest
// interactive elements.
//
// Same race-safety shape as mark-paid-button.tsx (the canonical comment lives there):
// the sheet closes eagerly, the action is called directly via useAction, and the toast
// fires in the same awaited closure — updateEntryDetailsAction's revalidatePath can
// unmount this row (e.g. a category change moves it between list groups) before any
// state-reactive effect would run.
export function EntryEditButton({
  entry,
  className,
}: {
  entry: EditableEntry;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`Edit ${entry.item}`}
        className={className}
        onClick={() => setOpen(true)}
      >
        <Pencil className="size-3.5" />
      </Button>
      <ResponsiveSheet
        open={open}
        onOpenChange={setOpen}
        title="Edit entry"
        description={
          entry.recurringLinked
            ? 'Category and actuals for this month’s instance. Rename it on the Plan page.'
            : 'Update this entry’s details.'
        }
      >
        <EntryEditForm entry={entry} onClose={() => setOpen(false)} />
      </ResponsiveSheet>
    </>
  );
}

function EntryEditForm({ entry, onClose }: { entry: EditableEntry; onClose: () => void }) {
  const { categories } = useQuickAddOpen();
  const { pending, run } = useAction(updateEntryDetailsAction);
  const toastManager = useToastManager();

  // The reserved Uncategorized category maps to the select's '' value (same contract
  // as quick-add: the server files '' under the system category).
  const systemId = categories.find((c) => c.isSystem)?.id ?? null;
  const initialCategoryValue =
    entry.categoryId === null || entry.categoryId === systemId ? '' : entry.categoryId;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('id', entry.id);
    onClose(); // eagerly — see the component comment above
    run(formData, (result) => {
      if (result?.error) {
        toastManager.add({
          type: 'error',
          title: 'Could not update entry',
          description: result.error,
        });
        return;
      }
      toastManager.add({ type: 'success', title: 'Entry updated' });
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" data-testid="entry-edit-form">
      <label className="flex flex-col gap-1 text-sm">
        Item
        <Input
          name="item"
          defaultValue={entry.item}
          required
          maxLength={200}
          disabled={entry.recurringLinked}
          title={entry.recurringLinked ? 'Rename this on the Plan page' : undefined}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Category
        <select
          name="categoryId"
          defaultValue={initialCategoryValue}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Uncategorized</option>
          {categories
            .filter((c) => !c.isSystem)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.direction === 'income' ? '↑' : '↓'} {c.name}
              </option>
            ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Actual amount
          <Input
            name="actualAmount"
            type="number"
            step="0.01"
            min="0"
            placeholder="—"
            defaultValue={entry.actualAmount ?? ''}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Actual date
          <Input name="actualDate" type="date" defaultValue={entry.actualDate ?? ''} />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
