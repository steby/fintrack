'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { changePasswordAction } from '../../../actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToastManager } from '@/components/ui/toast';

// Direct-call + startTransition (not useActionState + <form action>) — the established,
// debugged pattern for firing a toast tied to a Server Action result
// (app/(app)/home/mark-paid-button.tsx, components/theme-toggle.tsx): calling the
// action inside the SAME async closure that fires the toast means the toast never
// depends on this component surviving to observe a later render. Not strictly needed
// here (changePasswordAction never calls revalidatePath, so this component never
// unmounts), but kept consistent with every other new toast this phase adds rather than
// mixing in the render-time "reacted to" pattern (used elsewhere in this codebase only
// for this component's OWN setState calls, never for firing an external system like a
// toast — see mark-paid-button.tsx's comment for why that distinction matters). The
// inline "Password updated." text is preserved verbatim (not replaced by the toast) —
// e2e/auth.spec.ts asserts it directly and is one of the three specs (auth/invite/cron)
// this project's cross-phase rule says must never need churn.
export function ChangePasswordForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  // Controlled, not uncontrolled — a plain onSubmit handler (not <form action={...}>)
  // doesn't get React 19's auto-reset-on-action-settle behavior at all, but staying
  // controlled still means a deliberate reset (below) is the only thing that ever
  // clears these fields, not an implicit framework behavior.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const toastManager = useToastManager();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSucceeded(false);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await changePasswordAction(undefined, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setSucceeded(true);
      toastManager.add({ type: 'success', title: 'Password updated' });
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          Changing your password signs you out of every other active session.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {succeeded && <p className="text-sm text-income">Password updated.</p>}
          <Button type="submit" disabled={pending}>
            {pending ? 'Updating...' : 'Update password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
