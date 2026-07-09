'use client';

import { useActionState, useState } from 'react';
import { updateActualAction, overrideBudgetAction, deleteEntryAction } from '../../actions/monthly';
import { Button } from '@/components/ui/button';
import { formatSGD } from '../../../lib/format';
import { parseAmountToCents } from '../../../lib/money';
import { getDifference } from '../../../lib/domain/entries';
import type { MonthlyEntryRow } from './types';

export function EntryRow({ entry, canManage }: { entry: MonthlyEntryRow; canManage: boolean }) {
  const [actualState, actualAction, actualPending] = useActionState(updateActualAction, undefined);
  const [budgetState, budgetAction, budgetPending] = useActionState(
    overrideBudgetAction,
    undefined,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(deleteEntryAction, undefined);
  const [editingBudget, setEditingBudget] = useState(false);

  const [reactedTo, setReactedTo] = useState(budgetState);
  if (budgetState !== reactedTo) {
    setReactedTo(budgetState);
    if (budgetState?.success) setEditingBudget(false);
  }

  const budgetedCents = parseAmountToCents(entry.budgetedAmount);
  const actualCents = entry.actualAmount === null ? null : parseAmountToCents(entry.actualAmount);
  const difference =
    entry.categoryDirection &&
    getDifference({
      direction: entry.categoryDirection,
      budgetedCents,
      actualCents,
    });

  return (
    <tr data-testid="entry-row">
      <td className="p-2 font-medium">
        {entry.item}
        {!entry.recurringScheduleId && (
          <span className="ml-1.5 rounded bg-blue-500/10 px-1 py-0.5 text-[0.6rem] font-semibold text-blue-600">
            AD-HOC
          </span>
        )}
        {entry.isOverridden && (
          <span className="ml-1.5 rounded bg-amber-500/10 px-1 py-0.5 text-[0.6rem] font-semibold text-amber-600">
            OVERRIDDEN
          </span>
        )}
      </td>
      <td className="p-2">
        {entry.categoryName ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span
              className="size-2 rounded-full"
              style={{ background: entry.categoryColor ?? undefined }}
              aria-hidden
            />
            {entry.categoryName}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-2 text-right tabular-nums">
        {canManage && entry.recurringScheduleId && editingBudget ? (
          <form action={budgetAction} className="flex items-center justify-end gap-1">
            <input type="hidden" name="id" value={entry.id} />
            <input
              type="number"
              name="budgetedAmount"
              step="0.01"
              min="0"
              defaultValue={entry.budgetedAmount}
              className="h-9 w-24 rounded border bg-background px-1.5 text-right text-sm"
              autoFocus
            />
            <Button type="submit" size="icon-sm" variant="ghost" disabled={budgetPending}>
              ✓
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => setEditingBudget(false)}
            >
              ✕
            </Button>
          </form>
        ) : (
          <button
            type="button"
            disabled={!canManage || !entry.recurringScheduleId}
            onClick={() => setEditingBudget(true)}
            className="tabular-nums enabled:cursor-pointer enabled:hover:underline"
            title={entry.recurringScheduleId ? 'Override this month’s budgeted amount' : undefined}
          >
            {formatSGD(budgetedCents)}
          </button>
        )}
        {budgetState?.error && <p className="text-xs text-destructive">{budgetState.error}</p>}
      </td>
      <td className="p-2 text-right">
        {canManage ? (
          <form action={actualAction} className="flex flex-col items-end gap-1">
            <input type="hidden" name="id" value={entry.id} />
            <input
              type="number"
              name="actualAmount"
              step="0.01"
              min="0"
              placeholder="—"
              defaultValue={entry.actualAmount ?? ''}
              disabled={actualPending}
              className="h-9 w-24 rounded border bg-background px-1.5 text-right text-sm tabular-nums"
              // Commit on blur, not on every keystroke — React's onChange fires per
              // character (it's wired to the native "input" event), which combined with
              // disabled={actualPending} would submit mid-typing and eat keystrokes typed
              // while a prior submission is still in flight. onBlur + explicit Enter/Esc
              // handling matches the reference app's native onchange (fires on blur/commit
              // only) and spec.md's "keyboard-friendly: Enter saves, Esc cancels."
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.form?.requestSubmit();
                } else if (e.key === 'Escape') {
                  e.currentTarget.value = entry.actualAmount ?? '';
                  e.currentTarget.blur();
                }
              }}
            />
            <input
              type="date"
              name="actualDate"
              defaultValue={entry.actualDate ?? ''}
              disabled={actualPending}
              aria-label="Actual date"
              className="h-9 w-32 rounded border bg-background px-1.5 text-right text-xs tabular-nums"
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.form?.requestSubmit();
                } else if (e.key === 'Escape') {
                  e.currentTarget.value = entry.actualDate ?? '';
                  e.currentTarget.blur();
                }
              }}
            />
          </form>
        ) : (
          <div className="flex flex-col items-end gap-0.5">
            <span className="tabular-nums">
              {entry.actualAmount ? formatSGD(actualCents!) : '—'}
            </span>
            {entry.actualDate && (
              <span className="text-xs text-muted-foreground">{entry.actualDate}</span>
            )}
          </div>
        )}
        {actualState?.error && <p className="text-xs text-destructive">{actualState.error}</p>}
      </td>
      <td className="p-2 text-right tabular-nums">
        {difference ? (
          <span
            className={
              difference.favorable
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }
          >
            {difference.favorable ? '+' : ''}
            {formatSGD(difference.cents)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-2 text-xs text-muted-foreground">{entry.accountName ?? '—'}</td>
      <td className="p-2 text-right">
        {canManage && !entry.recurringScheduleId && (
          <form action={deleteAction}>
            <input type="hidden" name="id" value={entry.id} />
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
        )}
        {deleteState?.error && <p className="text-xs text-destructive">{deleteState.error}</p>}
      </td>
    </tr>
  );
}
