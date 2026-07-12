'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { createInviteAction } from '../../../actions/invites';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToastManager } from '@/components/ui/toast';

// Direct-call + startTransition, firing a toast from the same closure — same pattern as
// change-password-form.tsx and app/(app)/home/mark-paid-button.tsx (spec.md Phase 11:
// "save feedback -> toasts, inline validation errors stay"). No e2e spec exercises this
// form's UI directly (invite.spec.ts seeds invitations straight into the DB and tests
// the ACCEPT flow instead), so there's no protected inline-text assertion to preserve
// here the way change-password-form.tsx's is.
export function InviteForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toastManager = useToastManager();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get('email') ?? '');
    startTransition(async () => {
      const result = await createInviteAction(undefined, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      form.reset();
      toastManager.add({ type: 'success', title: 'Invite sent', description: email });
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite someone</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" name="email" type="email" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              name="role"
              defaultValue="viewer"
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              <option value="viewer">Viewer</option>
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? 'Sending...' : 'Send invite'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
