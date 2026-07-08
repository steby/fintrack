'use client';

import { useActionState, useState } from 'react';
import { updateCategoryAction, deleteCategoryAction } from '../../../actions/categories';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Category {
  id: string;
  name: string;
  direction: 'income' | 'expense';
  color: string;
}

export function CategoryRow({ category, canManage }: { category: Category; canManage: boolean }) {
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

  if (isEditing) {
    return (
      <form
        action={updateAction}
        data-testid="category-row"
        className="flex flex-col gap-2 rounded-md border p-2"
      >
        <input type="hidden" name="id" value={category.id} />
        <input type="hidden" name="direction" value={category.direction} />
        <div className="flex items-center gap-2">
          <Input name="name" defaultValue={category.name} required className="h-8" />
          <input
            type="color"
            name="color"
            defaultValue={category.color}
            className="h-8 w-10 cursor-pointer rounded-md border p-0.5"
          />
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
      {deleteState?.error && <p className="text-xs text-destructive">{deleteState.error}</p>}
    </div>
  );
}
