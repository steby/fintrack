'use client';

import { useActionState, useEffect, useRef } from 'react';
import { createCategoryAction } from '../../../actions/categories';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function CategoryAddForm() {
  const [state, action, pending] = useActionState(createCategoryAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  // React 19's uncontrolled-form auto-reset already clears the fields on any
  // non-throwing completion — this only needs to blank the color picker back to its
  // visual default, since <input type="color"> ignores the reset if no defaultValue
  // was set and would otherwise keep showing the last-picked swatch.
  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <Input name="name" placeholder="Category name" required className="h-8" />
        <select
          name="direction"
          defaultValue="expense"
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <input
          type="color"
          name="color"
          defaultValue="#6B7280"
          className="h-8 w-10 cursor-pointer rounded-md border p-0.5"
        />
        <Button type="submit" size="sm" disabled={pending}>
          Add
        </Button>
      </div>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
