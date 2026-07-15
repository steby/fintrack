'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { requestPasswordResetAction } from '../actions/password-reset';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            Enter your account email and we&apos;ll send a one-time reset link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state?.success ? (
            // Constant outcome copy — the action never reveals whether the email has an
            // account (see requestPasswordResetAction).
            <div className="flex flex-col gap-4">
              <p className="text-sm">
                If that email has a FinTrack account, a reset link is on its way. It works once and
                expires in 1 hour.
              </p>
              <Link href="/login" className="text-sm underline underline-offset-2">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form action={action} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? 'Sending…' : 'Send reset link'}
              </Button>
              <Link
                href="/login"
                className="text-center text-sm text-muted-foreground underline underline-offset-2"
              >
                Back to sign in
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
