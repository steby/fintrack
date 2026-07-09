'use client';

import { useActionState, useState } from 'react';
import { addAdhocAction } from '../../actions/monthly';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Option {
  id: string;
  name: string;
}

export function AdhocForm({
  year,
  month,
  categories,
  accounts,
  members,
  entryAttributionEnabled,
}: {
  year: number;
  month: number;
  categories: (Option & { direction: 'income' | 'expense' })[];
  accounts: Option[];
  members: Option[];
  entryAttributionEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addAdhocAction, undefined);

  const [reactedTo, setReactedTo] = useState(state);
  if (state !== reactedTo) {
    setReactedTo(state);
    if (state?.success) setOpen(false);
  }

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Ad-hoc entry
      </Button>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-2 rounded-md border p-3"
      data-testid="adhoc-form"
    >
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <label className="flex flex-col gap-1 text-xs">
        Item
        <Input name="item" placeholder="e.g. Car Repair" required className="h-8 w-40" />
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
        Actual
        <Input
          name="actualAmount"
          type="number"
          step="0.01"
          min="0"
          placeholder="Optional"
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
      {entryAttributionEnabled && (
        <label className="flex flex-col gap-1 text-xs">
          Paid by
          <select name="paidByUserId" className="h-8 rounded-md border bg-background px-2 text-sm">
            <option value="">Unspecified</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="ml-auto flex gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          Add entry
        </Button>
      </div>
      {state?.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
