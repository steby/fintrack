'use client';

import { useActionState } from 'react';
import { generateAction } from '../../actions/recurring';
import { addMonths } from '../../../lib/domain/recurring';
import { MONTH_SHORT } from '../../../lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

// A plain (always-centered) Dialog, not the ResponsiveSheet Goals' add/edit forms use —
// a deliberate plan choice (spec.md Phase 11: "Generate -> Dialog with the existing
// from/to fields"), not an oversight: four month/year fields fit comfortably in a
// centered dialog at any viewport width, with no natural "swipe to dismiss" affordance
// the way a bottom sheet implies. Uncontrolled (no open/onOpenChange props) — unlike
// quick-add.tsx, there's only ever one trigger for this dialog, and staying open after a
// successful generate (to show the "Generated N entries" message in place, matching the
// pre-restyle inline form's own behavior) needs no external state either.
export function GenerateForm() {
  const [state, action, pending] = useActionState(generateAction, undefined);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  // 12 months inclusive of the current one (current + 11 more) — addMonths correctly
  // rolls the year over regardless of which month "now" is.
  const toDefault = addMonths({ year: currentYear, month: currentMonth }, 11);

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            Generate forecast
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate forecast</DialogTitle>
          <DialogDescription>
            Materialize recurring items into actual monthly entries over a date range.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              From month
              <select
                name="fromMonth"
                defaultValue={currentMonth}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                {MONTH_SHORT.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              From year
              <Input name="fromYear" type="number" defaultValue={currentYear} className="h-8" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              To month
              <select
                name="toMonth"
                defaultValue={toDefault.month}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                {MONTH_SHORT.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              To year
              <Input name="toYear" type="number" defaultValue={toDefault.year} className="h-8" />
            </label>
          </div>
          {/* Just the submit button here — DialogContent already renders its own
              labeled close affordance (the top-right X icon, aria-label="Close"); a
              second "Close" button in the footer was redundant AND, in practice, an
              exact accessible-name collision (both literally named "Close") that broke
              a real Playwright test scoping on that name — removed, not renamed, since
              the X icon alone is sufficient. */}
          <DialogFooter>
            <Button type="submit" size="sm" disabled={pending}>
              Generate
            </Button>
          </DialogFooter>
          {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
          {state?.success && (
            <p className="text-xs text-income">
              Generated {state.generated} {state.generated === 1 ? 'entry' : 'entries'}.
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
