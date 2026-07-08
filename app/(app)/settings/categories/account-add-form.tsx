'use client';

import { useActionState, useEffect, useRef } from 'react';
import { createAccountAction } from '../../../actions/accounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface BankOnlyAccount {
  id: string;
  name: string;
}

export function AccountAddForm({ bankOnlyAccounts }: { bankOnlyAccounts: BankOnlyAccount[] }) {
  const [state, action, pending] = useActionState(createAccountAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <Input name="name" placeholder="Account name" required className="h-8" />
        <select
          name="accountType"
          defaultValue="bank"
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="bank">Bank</option>
          <option value="credit">Credit</option>
        </select>
        <select
          name="linkedBankAccountId"
          defaultValue=""
          className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">No linked account</option>
          {bankOnlyAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={pending}>
          Add
        </Button>
      </div>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
