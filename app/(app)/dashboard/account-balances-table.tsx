import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatSGD } from '../../../lib/format';

export interface AccountBalanceDisplay {
  accountId: string;
  name: string;
  balanceCents: number;
}

export function AccountBalancesTable({ accounts }: { accounts: AccountBalanceDisplay[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account balances</CardTitle>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No bank accounts to track a balance for.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {accounts.map((a) => (
              <div
                key={a.accountId}
                data-testid="account-balance-row"
                className="flex items-center justify-between text-sm"
              >
                <span>{a.name}</span>
                <span
                  className={`font-semibold tabular-nums ${
                    a.balanceCents < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {formatSGD(a.balanceCents)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
