'use client';

import { useState } from 'react';
import { toggleAutoGenerateAction } from '../../actions/recurring';
import { Switch } from '@/components/ui/switch';
import { useToastManager } from '@/components/ui/toast';
import { useAction } from '../../../lib/hooks/use-action';

// Bidirectional owner control for the auto_generate kill-switch (default ON) — reflects
// the current state and flips it either way. Auto-generate materializes recurring items
// into the visible/next months on page load; turning it off stops that instantly
// (without a redeploy) if it ever misbehaves. Direct-call + startTransition firing a
// toast from the same closure — the same pattern as csv-import-toggle.tsx.
export function AutoGenerateToggle({ enabled }: { enabled: boolean }) {
  const { pending, run } = useAction(toggleAutoGenerateAction);
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
      toastManager.add({ type: 'success', title: `Auto-generate turned ${next ? 'on' : 'off'}` });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        Auto-generate
        <Switch
          checked={enabled}
          onCheckedChange={handleCheckedChange}
          disabled={pending}
          data-testid="toggle-auto-generate"
          aria-label="Auto-generate forecast entries"
        />
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
