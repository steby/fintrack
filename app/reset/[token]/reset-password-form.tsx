'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { resetPasswordAction } from '../../actions/password-reset';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>
            You&apos;ll be signed in everywhere fresh — every existing session is signed out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="flex flex-col gap-4">
            <input type="hidden" name="token" value={token} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
            {state?.error && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-destructive">{state.error}</p>
                <Link href="/forgot-password" className="text-sm underline underline-offset-2">
                  Request a new link
                </Link>
              </div>
            )}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? 'Saving…' : 'Set new password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
