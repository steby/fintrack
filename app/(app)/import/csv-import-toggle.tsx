'use client';

import { useState } from 'react';
import { toggleCsvImportAction } from '../../actions/import';
import { Switch } from '@/components/ui/switch';
import { useToastManager } from '@/components/ui/toast';
import { useAction } from '../../../lib/hooks/use-action';

// Bidirectional kill-switch control for csv_import — reflects the CURRENT state
// (`checked={enabled}`) and flips it either way, so an owner can turn the feature back
// OFF, not only on (it was previously enable-only, which left no in-app way to disable
// it once on). Direct-call + startTransition (via the shared useAction hook — see
// lib/hooks/use-action.ts) firing a toast from the same closure: toggling revalidates
// the Import page, which can unmount THIS component as the page swaps between its
// enabled/disabled views — the same race app/(app)/home/mark-paid-button.tsx's comment
// documents, where a useActionState-bound toggle could lose the toast.
export function CsvImportToggle({ enabled }: { enabled: boolean }) {
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
          checked={enabled}
          onCheckedChange={handleCheckedChange}
          disabled={pending}
          data-testid="enable-csv-import"
          aria-label="CSV import"
        />
        CSV import {enabled ? 'enabled' : 'disabled'}
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
