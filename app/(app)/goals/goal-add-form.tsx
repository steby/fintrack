'use client';

import { useActionState, useEffect, useRef } from 'react';
import { createGoalAction } from '../../actions/goals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export function GoalAddForm() {
  const [state, action, pending] = useActionState(createGoalAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>New goal</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={action} className="flex flex-col gap-2">
          <Input name="name" placeholder="e.g. Emergency fund" required className="h-8" />
          <div className="flex items-center gap-2">
            <Input
              name="targetAmount"
              placeholder="Target amount"
              inputMode="decimal"
              required
              className="h-8"
            />
            <Input
              name="savedAmount"
              placeholder="Saved so far (optional)"
              inputMode="decimal"
              className="h-8"
            />
          </div>
          <Input name="targetDate" type="date" className="h-8" />
          <Button type="submit" size="sm" disabled={pending} className="self-start">
            Add goal
          </Button>
          {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
