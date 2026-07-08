'use client';

import { useActionState, useState } from 'react';
import { generateAction } from '../../actions/recurring';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function GenerateForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(generateAction, undefined);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const toDefault =
    currentMonth <= 12 ? { year: currentYear, month: 12 } : { year: currentYear + 1, month: 12 };

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Generate forecast
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-md border p-3">
      <label className="flex flex-col gap-1 text-xs">
        From month
        <select
          name="fromMonth"
          defaultValue={currentMonth}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        From year
        <Input name="fromYear" type="number" defaultValue={currentYear} className="h-8 w-24" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        To month
        <select
          name="toMonth"
          defaultValue={toDefault.month}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        To year
        <Input name="toYear" type="number" defaultValue={toDefault.year} className="h-8 w-24" />
      </label>
      <div className="flex gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          Generate
        </Button>
      </div>
      {state?.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
      {state?.success && (
        <p className="w-full text-xs text-emerald-600">
          Generated {state.generated} {state.generated === 1 ? 'entry' : 'entries'}.
        </p>
      )}
    </form>
  );
}
