'use client';

import { useState } from 'react';
import { sendTestEmailAction } from '../../../actions/notifications';
import { Button } from '@/components/ui/button';
import { useToastManager } from '@/components/ui/toast';
import { useAction } from '../../../../lib/hooks/use-action';

export function SendTestEmailButton() {
  const { pending, run } = useAction(sendTestEmailAction);
  const [error, setError] = useState<string | null>(null);
  const toastManager = useToastManager();

  function handleClick() {
    setError(null);
    run(new FormData(), (result) => {
      if (result?.error) {
        setError(result.error);
        return;
      }
      toastManager.add({
        type: 'success',
        title: 'Test email sent',
        description:
          "If RESEND_API_KEY isn't configured, check the server logs instead of your inbox.",
      });
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={handleClick}>
        {pending ? 'Sending…' : 'Send test email'}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
