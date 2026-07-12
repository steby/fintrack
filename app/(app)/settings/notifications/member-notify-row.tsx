'use client';

import { useState, useTransition } from 'react';
import { updateNotifyByEmailAction } from '../../../actions/notifications';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToastManager } from '@/components/ui/toast';

interface Member {
  id: string;
  name: string;
  email: string;
  notifyByEmail: boolean;
}

// Self-service only (spec.md: "recipient opt-in per member") — a member can see every
// household member's opt-in status, but can only flip their OWN, mirroring the
// isSelf-gated pattern member-row.tsx already uses for role changes/removal. Not a
// kill-switch (that's NotificationToggle, above it on the page), so this stays a plain
// Button rather than converting to Switch — spec.md Phase 11 only calls for "kill-switch
// toggles -> Switch." Direct-call + startTransition + toast (same pattern as this
// page's NotificationToggle) for the save feedback; the button's own text is unchanged
// so e2e/notifications.spec.ts's existing assertions ("Not emailing you"/"Emailing
// you") need no churn.
export function MemberNotifyRow({ member, isSelf }: { member: Member; isSelf: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toastManager = useToastManager();

  function handleClick() {
    setError(null);
    const next = !member.notifyByEmail;
    startTransition(async () => {
      const formData = new FormData();
      formData.set('enabled', next ? 'true' : 'false');
      const result = await updateNotifyByEmailAction(undefined, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      toastManager.add({
        title: next ? "You're now receiving these emails" : "You've opted out of these emails",
      });
    });
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border p-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">
            {member.name}
            {isSelf && ' (you)'}
          </div>
          <div className="text-xs text-muted-foreground">{member.email}</div>
        </div>
        {isSelf ? (
          <Button
            type="button"
            variant={member.notifyByEmail ? 'default' : 'outline'}
            size="sm"
            disabled={pending}
            onClick={handleClick}
          >
            {member.notifyByEmail ? 'Emailing you' : 'Not emailing you'}
          </Button>
        ) : (
          <Badge variant="secondary">{member.notifyByEmail ? 'Opted in' : 'Opted out'}</Badge>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
