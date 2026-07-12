'use client';

import { useActionState, useState } from 'react';
import { createGoalAction } from '../../actions/goals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';

// Add via ResponsiveSheet (spec.md Phase 11), replacing the always-visible inline Card
// the pre-restyle version rendered at the bottom of the page. The trigger button and
// the sheet's own submit button intentionally share the label "Add goal" — the closest
// match to the ORIGINAL single-button label — and coexist in the DOM once the sheet is
// open (Base UI's Dialog/Drawer trigger stays mounted while its content is open, unlike
// the show/hide toggle recurring-add-form.tsx uses for its own inline form), so they're
// disambiguated by data-testid="goal-add-form" scoping the submit button in tests, not
// by renaming either one — per the plan's own Playwright guidance ("scope locators to
// testid containers" rather than chase page-wide text matches).
export function GoalAddForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createGoalAction, undefined);

  // Render-time state sync (not useEffect+setState — see category-row.tsx for why):
  // close the sheet the instant a create succeeds. Safe here specifically because
  // closing only ever touches THIS component's own local state, never an external
  // system — see mark-paid-button.tsx's load-bearing comment for why a toast-firing
  // action must NOT use this same pattern.
  const [reactedTo, setReactedTo] = useState(state);
  if (state !== reactedTo) {
    setReactedTo(state);
    if (state?.success) setOpen(false);
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={setOpen}
      title="New goal"
      description="What is the household saving toward?"
      trigger={
        <Button type="button" size="sm">
          Add goal
        </Button>
      }
    >
      <form action={action} data-testid="goal-add-form" className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <Input name="name" placeholder="e.g. Emergency fund" required />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Target amount
            <Input name="targetAmount" placeholder="Target amount" inputMode="decimal" required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Saved so far
            <Input name="savedAmount" placeholder="Saved so far (optional)" inputMode="decimal" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Target date
          <Input name="targetDate" type="date" />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add goal'}
        </Button>
        {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
      </form>
    </ResponsiveSheet>
  );
}
