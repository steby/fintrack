'use client';

import { useActionState } from 'react';
import type { ToggleFlagActionState } from '../../../actions/notifications';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Props {
  action: (prevState: ToggleFlagActionState, formData: FormData) => Promise<ToggleFlagActionState>;
  enabled: boolean;
  label: string;
  description: string;
  readOnly: boolean;
}

// Shared by both kill-switch toggles (email_reminders, monthly_recap) — the two
// Server Actions behind them stay separate (app/actions/notifications.ts), but the
// button itself is pure UI with no domain logic of its own, so there's nothing lost by
// sharing one widget the way member-row.tsx's role <select> is its own one-off.
export function NotificationToggle({ action, enabled, label, description, readOnly }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {readOnly ? (
        <Badge variant="secondary">{enabled ? 'On' : 'Off'}</Badge>
      ) : (
        <div className="flex flex-col items-end gap-1">
          <form action={formAction}>
            <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
            <Button
              type="submit"
              variant={enabled ? 'default' : 'outline'}
              size="sm"
              disabled={pending}
            >
              {enabled ? 'On' : 'Off'}
            </Button>
          </form>
          {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
        </div>
      )}
    </div>
  );
}
