'use client';

import { useActionState, useState } from 'react';
import { createRecurringAction } from '../../actions/recurring';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Option {
  id: string;
  name: string;
}

export function RecurringAddForm({
  categories,
  accounts,
}: {
  categories: (Option & { direction: 'income' | 'expense' })[];
  accounts: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createRecurringAction, undefined);
  const [frequency, setFrequency] = useState<'Monthly' | 'Quarterly' | 'Yearly'>('Monthly');

  // See category-row.tsx for why this runs during render rather than in a useEffect.
  // No separate form.reset() is needed: closing the form (setOpen(false)) unmounts it,
  // so the next "Add item" click mounts a fresh form with empty defaultValues anyway.
  const [reactedTo, setReactedTo] = useState(state);
  if (state !== reactedTo) {
    setReactedTo(state);
    if (state?.success) {
      setFrequency('Monthly');
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Add item
      </Button>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-2 rounded-2xl border bg-card p-3 shadow-card"
    >
      <label className="flex flex-col gap-1 text-xs">
        Item
        <Input name="item" placeholder="e.g. Spotify Duo" required className="h-8 w-40" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Category
        <select name="categoryId" className="h-8 rounded-md border bg-background px-2 text-sm">
          <option value="">None</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.direction === 'income' ? '↑' : '↓'} {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Budgeted
        <Input
          name="budgetedAmount"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          className="h-8 w-28"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Account
        <select name="bankAccountId" className="h-8 rounded-md border bg-background px-2 text-sm">
          <option value="">None</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Frequency
        <select
          name="frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as typeof frequency)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="Monthly">Monthly</option>
          <option value="Quarterly">Quarterly</option>
          <option value="Yearly">Yearly</option>
        </select>
      </label>
      {frequency !== 'Monthly' && (
        <label className="flex flex-col gap-1 text-xs">
          Months
          <Input name="scheduleMonths" placeholder="e.g. 1,4,7,10" className="h-8 w-28" />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs">
        Day
        <Input name="actualDateDay" type="number" min="1" max="31" className="h-8 w-16" />
      </label>
      <div className="ml-auto flex gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          Add
        </Button>
      </div>
      {state?.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
