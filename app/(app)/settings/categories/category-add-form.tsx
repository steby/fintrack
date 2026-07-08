'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { createCategoryAction } from '../../../actions/categories';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function CategoryAddForm({ showBudget }: { showBudget: boolean }) {
  const [state, action, pending] = useActionState(createCategoryAction, undefined);
  const [direction, setDirection] = useState<'income' | 'expense'>('expense');
  const formRef = useRef<HTMLFormElement>(null);

  // React 19's uncontrolled-form auto-reset already clears the fields on any
  // non-throwing completion — this only needs to blank the color picker back to its
  // visual default, since <input type="color"> ignores the reset if no defaultValue
  // was set and would otherwise keep showing the last-picked swatch. direction is
  // controlled (see below), so its own reset happens via setDirection, not form.reset().
  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  // See category-row.tsx for why this runs during render rather than in the effect
  // above — mixing a setState call into an effect that also does a DOM mutation
  // (form.reset()) is what trips react-hooks/set-state-in-effect.
  const [reactedTo, setReactedTo] = useState(state);
  if (state !== reactedTo) {
    setReactedTo(state);
    if (state?.success) setDirection('expense');
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input name="name" placeholder="Category name" required className="h-8" />
        <select
          name="direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value as 'income' | 'expense')}
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
        {/* A budget cap only means anything against expense entries (server-enforced
            in app/actions/categories.ts) — hidden for 'income' so the form can't be
            submitted into a combination the server will reject. */}
        {showBudget && direction === 'expense' && (
          <Input
            name="monthlyBudget"
            placeholder="Budget cap"
            inputMode="decimal"
            className="h-8 w-28"
          />
        )}
        <Button type="submit" size="sm" disabled={pending}>
          Add
        </Button>
      </div>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
