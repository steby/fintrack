'use client';

import { useActionState } from 'react';
import { toggleCsvImportAction } from '../../actions/import';
import { Button } from '@/components/ui/button';

export function CsvImportToggle() {
  const [state, action, pending] = useActionState(toggleCsvImportAction, undefined);

  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="enabled" value="true" />
      <Button type="submit" size="sm" disabled={pending} data-testid="enable-csv-import">
        Enable CSV import
      </Button>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
