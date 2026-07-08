'use client';

import { useActionState, useState } from 'react';
import {
  updateRecurringAction,
  deleteRecurringAction,
  toggleRecurringAction,
} from '../../actions/recurring';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatSGD } from '../../../lib/format';
import { parseAmountToCents } from '../../../lib/money';

export interface RecurringItem {
  id: string;
  item: string;
  categoryId: string | null;
  budgetedAmount: string;
  bankAccountId: string | null;
  frequency: 'Monthly' | 'Quarterly' | 'Yearly';
  scheduleMonths: string | null;
  actualDateDay: number | null;
  isActive: boolean;
  categoryName: string | null;
  categoryColor: string | null;
  accountName: string | null;
}

interface Option {
  id: string;
  name: string;
}

export function RecurringRow({
  item,
  categories,
  accounts,
  showMonthsColumn,
  canManage,
}: {
  item: RecurringItem;
  categories: (Option & { direction: 'income' | 'expense' })[];
  accounts: Option[];
  showMonthsColumn: boolean;
  canManage: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(
    updateRecurringAction,
    undefined,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteRecurringAction,
    undefined,
  );
  const [toggleState, toggleAction, togglePending] = useActionState(
    toggleRecurringAction,
    undefined,
  );

  // See app/(app)/settings/categories/category-row.tsx for why this runs during
  // render rather than in a useEffect.
  const [reactedTo, setReactedTo] = useState(updateState);
  if (updateState !== reactedTo) {
    setReactedTo(updateState);
    if (updateState?.success) setIsEditing(false);
  }

  if (isEditing) {
    return (
      <tr data-testid="recurring-row">
        <td colSpan={showMonthsColumn ? 8 : 7} className="p-2">
          <form
            action={updateAction}
            className="flex flex-wrap items-end gap-2 rounded-md border p-3"
          >
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="frequency" value={item.frequency} />
            <label className="flex flex-col gap-1 text-xs">
              Item
              <Input name="item" defaultValue={item.item} required className="h-8 w-40" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Category
              <select
                name="categoryId"
                defaultValue={item.categoryId ?? ''}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
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
                defaultValue={item.budgetedAmount}
                className="h-8 w-28"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Account
              <select
                name="bankAccountId"
                defaultValue={item.bankAccountId ?? ''}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">None</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            {item.frequency !== 'Monthly' && (
              <label className="flex flex-col gap-1 text-xs">
                Months
                <Input
                  name="scheduleMonths"
                  defaultValue={item.scheduleMonths ?? ''}
                  placeholder="e.g. 1,4,7,10"
                  className="h-8 w-28"
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs">
              Day
              <Input
                name="actualDateDay"
                type="number"
                min="1"
                max="31"
                defaultValue={item.actualDateDay ?? ''}
                className="h-8 w-16"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" name="propagate" value="yes" defaultChecked />
              Propagate to forecast
            </label>
            <div className="ml-auto flex gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={updatePending}>
                Save
              </Button>
            </div>
            {updateState?.error && (
              <p className="w-full text-xs text-destructive">{updateState.error}</p>
            )}
          </form>
        </td>
      </tr>
    );
  }

  const budgetedCents = parseAmountToCents(item.budgetedAmount);

  return (
    <tr data-testid="recurring-row" className={item.isActive ? '' : 'opacity-50'}>
      <td className="p-2 font-medium">{item.item}</td>
      <td className="p-2">
        {item.categoryName ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span
              className="size-2 rounded-full"
              style={{ background: item.categoryColor ?? undefined }}
              aria-hidden
            />
            {item.categoryName}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-2 text-right tabular-nums">{formatSGD(budgetedCents)}</td>
      <td className="p-2 text-xs text-muted-foreground">{item.accountName ?? '—'}</td>
      {showMonthsColumn && (
        <td className="p-2 text-xs text-muted-foreground">{item.scheduleMonths ?? '—'}</td>
      )}
      <td className="p-2 text-xs text-muted-foreground">{item.actualDateDay ?? '—'}</td>
      <td className="p-2">
        {canManage ? (
          <form action={toggleAction}>
            <input type="hidden" name="id" value={item.id} />
            <button
              type="submit"
              disabled={togglePending}
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                item.isActive
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {item.isActive ? 'Active' : 'Inactive'}
            </button>
          </form>
        ) : (
          <span className="text-xs text-muted-foreground">
            {item.isActive ? 'Active' : 'Inactive'}
          </span>
        )}
        {toggleState?.error && <p className="text-xs text-destructive">{toggleState.error}</p>}
      </td>
      {canManage && (
        <td className="p-2 text-right">
          <div className="flex justify-end gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
            <form action={deleteAction}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="removeForecast" value="yes" />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={deletePending}
              >
                Delete
              </Button>
            </form>
          </div>
          {deleteState?.error && <p className="text-xs text-destructive">{deleteState.error}</p>}
        </td>
      )}
    </tr>
  );
}
