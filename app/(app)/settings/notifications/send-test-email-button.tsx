'use client';

import { useState, useTransition } from 'react';
import { sendTestEmailAction } from '../../../actions/notifications';
import { Button } from '@/components/ui/button';
import { useToastManager } from '@/components/ui/toast';

export function SendTestEmailButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toastManager = useToastManager();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await sendTestEmailAction(undefined, new FormData());
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
