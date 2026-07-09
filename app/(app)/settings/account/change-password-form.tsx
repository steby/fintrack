'use client';

import { useActionState, useState } from 'react';
import { changePasswordAction } from '../../../actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  // Controlled, not uncontrolled defaultValue fields — React 19 auto-resets an
  // uncontrolled <form action={...}> once the action settles, including on an error
  // return (not just success), silently clearing both password fields right as the
  // user reads why their submission failed. A controlled value survives that reset
  // (React keeps rendering the state-held value), so only the success branch below
  // clears the fields deliberately.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [reactedTo, setReactedTo] = useState(state);
  if (state !== reactedTo) {
    setReactedTo(state);
    if (state?.success) {
      setCurrentPassword('');
      setNewPassword('');
    }
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
        <form action={action} className="flex flex-col gap-4">
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
          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          {state?.success && <p className="text-sm text-green-600">Password updated.</p>}
          <Button type="submit" disabled={pending}>
            {pending ? 'Updating...' : 'Update password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
