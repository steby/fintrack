'use client';

import { useState } from 'react';
import { toggleCsvImportAction } from '../../actions/import';
import { Switch } from '@/components/ui/switch';
import { useToastManager } from '@/components/ui/toast';
import { useAction } from '../../../lib/hooks/use-action';

// Restyled onto the Switch primitive (spec.md Phase 11: "kill-switch toggles ->
// Switch"). Direct-call + startTransition (via the shared useAction hook — see
// lib/hooks/use-action.ts), firing a toast from the same closure — this component's
// own parent branch (app/(app)/import/page.tsx's `if (!enabled)` guard) unmounts THIS
// exact component the instant the toggle succeeds and the page revalidates into its
// "enabled" view, the precise race app/(app)/home/mark-paid-button.tsx's comment
// documents; a useActionState-bound toggle here could lose the toast the same way an
// early MarkPaidButton did. Always renders unchecked (`checked={false}`) — this
// component only ever mounts while the flag is off, per its one call site.
export function CsvImportToggle() {
  const { pending, run } = useAction(toggleCsvImportAction);
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
      toastManager.add({ type: 'success', title: `CSV import turned ${next ? 'on' : 'off'}` });
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={false}
          onCheckedChange={handleCheckedChange}
          disabled={pending}
          data-testid="enable-csv-import"
          aria-label="Enable CSV import"
        />
        Enable CSV import
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
