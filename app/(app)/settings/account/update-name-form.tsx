'use client';

import { useState, type FormEvent } from 'react';
import { updateNameAction } from '../../../actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToastManager } from '@/components/ui/toast';
import { useAction } from '../../../../lib/hooks/use-action';

// Same direct-call + useAction pattern as change-password-form.tsx in this same
// directory (see that file's comment for the full race-safety rationale) — kept
// consistent even though updateNameAction's revalidatePath('/', 'layout') doesn't
// unmount this component either.
export function UpdateNameForm({ currentName }: { currentName: string }) {
  const { pending, run } = useAction(updateNameAction);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(currentName);
  const toastManager = useToastManager();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    run(formData, (result) => {
      if (result?.error) {
        setError(result.error);
        return;
      }
      toastManager.add({ type: 'success', title: 'Name updated' });
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your name</CardTitle>
        <CardDescription>
          Shown in the sidebar, navigation, and household member list.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending || name.trim() === ''}>
            {pending ? 'Saving...' : 'Save name'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
