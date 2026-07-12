'use client';

import { useState } from 'react';
import type { ToggleFlagActionState } from '../../../actions/notifications';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToastManager } from '@/components/ui/toast';
import { useAction } from '../../../../lib/hooks/use-action';

interface Props {
  action: (prevState: ToggleFlagActionState, formData: FormData) => Promise<ToggleFlagActionState>;
  enabled: boolean;
  label: string;
  description: string;
  readOnly: boolean;
}

// Shared by both kill-switch toggles (email_reminders, monthly_recap) — restyled onto
// the Switch primitive (spec.md Phase 11: "kill-switch toggles -> Switch") and firing a
// toast on save via direct-call + startTransition (same pattern as
// change-password-form.tsx / mark-paid-button.tsx), replacing the plain Button + inline
// error text this component used pre-restyle. No e2e spec asserted specific button text
// beyond "On"/"Off" (updated in e2e/notifications.spec.ts to a switch-role check
// instead), so there's no protected text to preserve.
export function NotificationToggle({ action, enabled, label, description, readOnly }: Props) {
  const { pending, run } = useAction(action);
  const [error, setError] = useState<string | null>(null);
  const toastManager = useToastManager();

  function handleCheckedChange(next: boolean) {
    setError(null);
    const formData = new FormData();
    formData.set('enabled', next ? 'true' : 'false');
    run(formData, (result) => {
      if (result?.error) {
        setError(result.error);
        return;
      }
      toastManager.add({
        type: 'success',
        title: `${label} turned ${next ? 'on' : 'off'}`,
      });
    });
  }

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
          <Switch
            checked={enabled}
            onCheckedChange={handleCheckedChange}
            disabled={pending}
            aria-label={label}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
