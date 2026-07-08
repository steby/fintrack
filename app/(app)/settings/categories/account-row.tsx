'use client';

import { useActionState, useState } from 'react';
import { updateAccountAction, deleteAccountAction } from '../../../actions/accounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface Account {
  id: string;
  name: string;
  accountType: 'bank' | 'credit';
  linkedBankAccountId: string | null;
}

interface BankOnlyAccount {
  id: string;
  name: string;
}

export function AccountRow({
  account,
  bankOnlyAccounts,
  canManage,
}: {
  account: Account;
  bankOnlyAccounts: BankOnlyAccount[];
  canManage: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(updateAccountAction, undefined);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteAccountAction, undefined);

  // See category-row.tsx for why this is done during render rather than in a useEffect.
  const [reactedTo, setReactedTo] = useState(updateState);
  if (updateState !== reactedTo) {
    setReactedTo(updateState);
    if (updateState?.success) setIsEditing(false);
  }

  const linkedName = bankOnlyAccounts.find((a) => a.id === account.linkedBankAccountId)?.name;
  // A credit account can't link to itself, and a bank account can't link to anything —
  // the linked-account dropdown only ever offers OTHER bank accounts.
  const linkOptions = bankOnlyAccounts.filter((a) => a.id !== account.id);

  if (isEditing) {
    return (
      <form
        action={updateAction}
        data-testid="account-row"
        className="flex flex-col gap-2 rounded-md border p-2"
      >
        <input type="hidden" name="id" value={account.id} />
        <Input name="name" defaultValue={account.name} required className="h-8" />
        <div className="flex items-center gap-2">
          <select
            name="accountType"
            defaultValue={account.accountType}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="bank">Bank</option>
            <option value="credit">Credit</option>
          </select>
          <select
            name="linkedBankAccountId"
            defaultValue={account.linkedBankAccountId ?? ''}
            className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">No linked account</option>
            {linkOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={updatePending}>
            Save
          </Button>
        </div>
        {updateState?.error && <p className="text-xs text-destructive">{updateState.error}</p>}
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-testid="account-row">
      <div className="flex items-center justify-between gap-2 rounded-md border p-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">{account.name}</span>
          <Badge variant="secondary" className="capitalize">
            {account.accountType}
          </Badge>
          {linkedName && <span className="text-xs text-muted-foreground">-&gt; {linkedName}</span>}
        </div>
        {canManage && (
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
            <form action={deleteAction}>
              <input type="hidden" name="id" value={account.id} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={deletePending}
              >
                Delete
              </Button>
            </form>
          </div>
        )}
      </div>
      {deleteState?.error && <p className="text-xs text-destructive">{deleteState.error}</p>}
    </div>
  );
}
