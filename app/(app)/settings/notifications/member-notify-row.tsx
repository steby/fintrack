'use client';

import { useActionState } from 'react';
import { updateNotifyByEmailAction } from '../../../actions/notifications';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Member {
  id: string;
  name: string;
  email: string;
  notifyByEmail: boolean;
}

// Self-service only (spec.md: "recipient opt-in per member") — a member can see every
// household member's opt-in status, but can only flip their OWN, mirroring the
// isSelf-gated pattern member-row.tsx already uses for role changes/removal.
export function MemberNotifyRow({ member, isSelf }: { member: Member; isSelf: boolean }) {
  const [state, formAction, pending] = useActionState(updateNotifyByEmailAction, undefined);

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
          <form action={formAction}>
            <input type="hidden" name="enabled" value={member.notifyByEmail ? 'false' : 'true'} />
            <Button
              type="submit"
              variant={member.notifyByEmail ? 'default' : 'outline'}
              size="sm"
              disabled={pending}
            >
              {member.notifyByEmail ? 'Emailing you' : 'Not emailing you'}
            </Button>
          </form>
        ) : (
          <Badge variant="secondary">{member.notifyByEmail ? 'Opted in' : 'Opted out'}</Badge>
        )}
      </div>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </div>
  );
}
