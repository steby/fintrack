'use client';

import { useActionState } from 'react';
import { sendTestEmailAction } from '../../../actions/notifications';
import { Button } from '@/components/ui/button';

export function SendTestEmailButton() {
  const [state, formAction, pending] = useActionState(sendTestEmailAction, undefined);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? 'Sending…' : 'Send test email'}
      </Button>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
      {state?.success && (
        <p className="text-xs text-muted-foreground">
          Sent. If RESEND_API_KEY isn&apos;t configured, check the server logs instead of your
          inbox.
        </p>
      )}
    </form>
  );
}
