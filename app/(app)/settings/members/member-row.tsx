'use client';

import { useState, useTransition } from 'react';
import { changeMemberRoleAction, removeMemberAction } from '../../../actions/members';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToastManager } from '@/components/ui/toast';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}

// Both actions here are direct-call + startTransition, firing a toast from the same
// closure (spec.md Phase 11: "save feedback -> toasts") — role change leaves this row
// mounted (only its own badge/select changes), but Remove deletes the row via
// revalidatePath('/settings/members'), which unmounts this exact component in the same
// commit the result arrives in. That's precisely the race
// app/(app)/home/mark-paid-button.tsx's comment documents (a useActionState-bound
// version could lose the toast); calling the action directly and firing the toast
// before this component's fate is decided sidesteps it for both actions, not just the
// one that actually needs it, so the two don't drift into two different patterns on the
// same row.
export function MemberRow({ member, isSelf }: { member: Member; isSelf: boolean }) {
  const [rolePending, startRoleTransition] = useTransition();
  const [removePending, startRemoveTransition] = useTransition();
  const [roleError, setRoleError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const toastManager = useToastManager();

  function handleRoleChange(role: string) {
    setRoleError(null);
    startRoleTransition(async () => {
      const formData = new FormData();
      formData.set('userId', member.id);
      formData.set('role', role);
      const result = await changeMemberRoleAction(undefined, formData);
      if (result?.error) {
        setRoleError(result.error);
        return;
      }
      toastManager.add({ title: `${member.name}'s role updated`, description: `Now ${role}.` });
    });
  }

  function handleRemove() {
    setRemoveError(null);
    startRemoveTransition(async () => {
      const formData = new FormData();
      formData.set('userId', member.id);
      const result = await removeMemberAction(undefined, formData);
      if (result?.error) {
        setRemoveError(result.error);
        return;
      }
      toastManager.add({ title: `Removed ${member.name}`, type: 'success' });
    });
  }

  return (
    <div className="flex flex-col gap-1 rounded-2xl border bg-card p-3 shadow-card">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">
            {member.name}
            {isSelf && ' (you)'}
          </div>
          <div className="text-xs text-muted-foreground">{member.email}</div>
        </div>
        <div className="flex items-center gap-2">
          {isSelf ? (
            <Badge variant="secondary" className="capitalize">
              {member.role}
            </Badge>
          ) : (
            <>
              <select
                name="role"
                defaultValue={member.role}
                disabled={rolePending}
                className="h-7 rounded-md border bg-background px-1.5 text-xs"
                onChange={(e) => handleRoleChange(e.target.value)}
              >
                <option value="viewer">Viewer</option>
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </select>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={removePending}
                onClick={handleRemove}
              >
                Remove
              </Button>
            </>
          )}
        </div>
      </div>
      {roleError && <p className="text-xs text-destructive">{roleError}</p>}
      {removeError && <p className="text-xs text-destructive">{removeError}</p>}
    </div>
  );
}
