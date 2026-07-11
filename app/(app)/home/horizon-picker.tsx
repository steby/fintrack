'use client';

import { useActionState } from 'react';
import { setHorizonAction } from '../../actions/settings';
import { Button } from '@/components/ui/button';
import type { Horizon } from '../../../lib/domain/affordability';

// Segmented control, not the plan's originally-sketched Popover — Phase 8 didn't build
// a popover.tsx primitive (Tooltip/Dialog/Drawer/ResponsiveSheet were the only overlay
// primitives shipped that phase, per its own task list), and adding a brand-new base-ui
// overlay wrapper purely for a 4-option picker was judged out of this phase's scope
// (spec.md Phase 9 task 1-6 never lists a new primitive). Four always-visible buttons
// are simpler, need no overlay/focus-trap plumbing, and are equally reachable on mobile
// and desktop — a deliberate, logged deviation from the plan's literal wording, not an
// oversight.
const OPTIONS: { value: 'month' | '7' | '14' | '30'; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: '7', label: '7d' },
  { value: '14', label: '14d' },
  { value: '30', label: '30d' },
];

export function HorizonPicker({ horizon }: { horizon: Horizon }) {
  const [, action, pending] = useActionState(setHorizonAction, undefined);
  const current = String(horizon);

  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Forecast horizon">
      {OPTIONS.map((opt) => (
        <form action={action} key={opt.value}>
          <input type="hidden" name="horizon" value={opt.value} />
          <Button
            type="submit"
            size="xs"
            variant={current === opt.value ? 'default' : 'outline'}
            disabled={pending}
            aria-pressed={current === opt.value}
          >
            {opt.label}
          </Button>
        </form>
      ))}
    </div>
  );
}
