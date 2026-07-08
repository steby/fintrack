'use client';

import { useActionState } from 'react';
import { changeMemberRoleAction, removeMemberAction } from '../../../actions/members';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function MemberRow({ member, isSelf }: { member: Member; isSelf: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState(changeMemberRoleAction, undefined);
  const [removeState, removeAction, removePending] = useActionState(removeMemberAction, undefined);

  return (
    <div className="flex flex-col gap-1 rounded-md border p-3">
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
              <form action={roleAction}>
                <input type="hidden" name="userId" value={member.id} />
                <select
                  name="role"
                  defaultValue={member.role}
                  disabled={rolePending}
                  className="h-7 rounded-md border bg-background px-1.5 text-xs"
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                >
                  <option value="viewer">Viewer</option>
                  <option value="member">Member</option>
                  <option value="owner">Owner</option>
                </select>
              </form>
              <form action={removeAction}>
                <input type="hidden" name="userId" value={member.id} />
                <Button type="submit" variant="destructive" size="sm" disabled={removePending}>
                  Remove
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
      {roleState?.error && <p className="text-xs text-destructive">{roleState.error}</p>}
      {removeState?.error && <p className="text-xs text-destructive">{removeState.error}</p>}
    </div>
  );
}
