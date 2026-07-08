'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { createAccountAction } from '../../../actions/accounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface BankOnlyAccount {
  id: string;
  name: string;
}

export function AccountAddForm({
  bankOnlyAccounts,
  showOpeningBalance,
}: {
  bankOnlyAccounts: BankOnlyAccount[];
  showOpeningBalance: boolean;
}) {
  const [state, action, pending] = useActionState(createAccountAction, undefined);
  const [accountType, setAccountType] = useState<'bank' | 'credit'>('bank');
  const formRef = useRef<HTMLFormElement>(null);

  // See category-row.tsx for why the accountType reset runs during render rather than
  // in the effect below — mixing a setState call into an effect that also does a DOM
  // mutation (form.reset()) is what trips react-hooks/set-state-in-effect.
  const [reactedTo, setReactedTo] = useState(state);
  if (state !== reactedTo) {
    setReactedTo(state);
    if (state?.success) setAccountType('bank');
  }

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input name="name" placeholder="Account name" required className="h-8" />
        <select
          name="accountType"
          value={accountType}
          onChange={(e) => setAccountType(e.target.value as 'bank' | 'credit')}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="bank">Bank</option>
          <option value="credit">Credit</option>
        </select>
        {/* Only a 'credit' account can link to a bank account (server-enforced in
            app/actions/accounts.ts) — hidden for 'bank' so the form can't be submitted
            into a combination the server will reject. */}
        {accountType === 'credit' && (
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
        )}
        {/* Credit accounts have no balance of their own in the net-worth model (spec.md
            Phase 4: their spend rolls up into whichever bank account they're linked to
            instead) — only shown for 'bank' accounts. */}
        {showOpeningBalance && accountType === 'bank' && (
          <Input
            name="openingBalance"
            placeholder="Opening balance"
            inputMode="decimal"
            className="h-8 w-32"
          />
        )}
        <Button type="submit" size="sm" disabled={pending}>
          Add
        </Button>
      </div>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
