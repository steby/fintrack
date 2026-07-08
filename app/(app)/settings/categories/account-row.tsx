'use client';

import { useActionState, useState } from 'react';
import { updateAccountAction, deleteAccountAction } from '../../../actions/accounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatSGD } from '../../../../lib/format';
import { parseAmountToCents } from '../../../../lib/money';

interface Account {
  id: string;
  name: string;
  accountType: 'bank' | 'credit';
  linkedBankAccountId: string | null;
  openingBalance: string;
}

interface BankOnlyAccount {
  id: string;
  name: string;
}

export function AccountRow({
  account,
  bankOnlyAccounts,
  canManage,
  showOpeningBalance,
}: {
  account: Account;
  bankOnlyAccounts: BankOnlyAccount[];
  canManage: boolean;
  showOpeningBalance: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [accountType, setAccountType] = useState(account.accountType);
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
        <div className="flex flex-wrap items-center gap-2">
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
          )}
          {showOpeningBalance && accountType === 'bank' && (
            <Input
              name="openingBalance"
              placeholder="Opening balance"
              defaultValue={account.openingBalance}
              inputMode="decimal"
              className="h-8 w-32"
            />
          )}
        </div>
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setAccountType(account.accountType);
              setIsEditing(false);
            }}
          >
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
          {showOpeningBalance && account.accountType === 'bank' && (
            <span className="text-xs text-muted-foreground">
              Opening: {formatSGD(parseAmountToCents(account.openingBalance))}
            </span>
          )}
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
