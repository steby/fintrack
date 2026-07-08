'use client';

import { useActionState, useState } from 'react';
import { updateCategoryAction, deleteCategoryAction } from '../../../actions/categories';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { computeBudgetProgress } from '../../../../lib/domain/budgeting';
import { formatSGD } from '../../../../lib/format';
import { parseAmountToCents } from '../../../../lib/money';

interface Category {
  id: string;
  name: string;
  direction: 'income' | 'expense';
  color: string;
  monthlyBudget: string | null;
}

function BudgetBar({ capCents, spentCents }: { capCents: number; spentCents: number }) {
  const progress = computeBudgetProgress(spentCents, capCents);
  const barWidth = Math.min(100, progress.percentage ?? 0);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${progress.isOverCap ? 'bg-red-500' : 'bg-emerald-500'}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <div
        className={`text-[0.65rem] ${progress.isOverCap ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
      >
        {formatSGD(spentCents)} / {formatSGD(capCents)} this month
      </div>
    </div>
  );
}

export function CategoryRow({
  category,
  canManage,
  showBudget,
  currentMonthSpentCents,
}: {
  category: Category;
  canManage: boolean;
  showBudget: boolean;
  // Present only when showBudget is true and this category has a cap set — the caller
  // (page.tsx) already scoped this to expense categories with a non-null monthlyBudget.
  currentMonthSpentCents?: number;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(
    updateCategoryAction,
    undefined,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteCategoryAction,
    undefined,
  );

  // React's documented pattern for "adjust state when a value changes" (not an effect,
  // since useActionState's returned state object is a fresh reference each time the
  // action resolves — comparing it during render, not via useEffect, avoids the extra
  // render pass a setState-in-effect would cause).
  const [reactedTo, setReactedTo] = useState(updateState);
  if (updateState !== reactedTo) {
    setReactedTo(updateState);
    if (updateState?.success) setIsEditing(false);
  }

  const capCents =
    category.monthlyBudget === null ? null : parseAmountToCents(category.monthlyBudget);

  if (isEditing) {
    return (
      <form
        action={updateAction}
        data-testid="category-row"
        className="flex flex-col gap-2 rounded-md border p-2"
      >
        <input type="hidden" name="id" value={category.id} />
        <input type="hidden" name="direction" value={category.direction} />
        <div className="flex flex-wrap items-center gap-2">
          <Input name="name" defaultValue={category.name} required className="h-8" />
          <input
            type="color"
            name="color"
            defaultValue={category.color}
            className="h-8 w-10 cursor-pointer rounded-md border p-0.5"
          />
          {showBudget && (
            <Input
              name="monthlyBudget"
              placeholder="Budget cap"
              defaultValue={category.monthlyBudget ?? ''}
              inputMode="decimal"
              className="h-8 w-28"
            />
          )}
        </div>
        <div className="flex justify-end gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={updatePending}>
            Save
          </Button>
        </div>
        {updateState?.error && <p className="text-xs text-destructive">{updateState.error}</p>}
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-testid="category-row">
      <div className="flex items-center justify-between gap-2 rounded-md border p-2">
        <div className="flex items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: category.color }}
            aria-hidden
          />
          <span className="text-sm">{category.name}</span>
        </div>
        {canManage && (
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
            <form action={deleteAction}>
              <input type="hidden" name="id" value={category.id} />
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
        )}
      </div>
      {showBudget && capCents !== null && (
        <BudgetBar capCents={capCents} spentCents={currentMonthSpentCents ?? 0} />
      )}
      {deleteState?.error && <p className="text-xs text-destructive">{deleteState.error}</p>}
    </div>
  );
}
