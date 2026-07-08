import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatSGD } from '../../../lib/format';
import type { BankSummaryPoint } from '../../../lib/domain/dashboard';

export function BankSummaryTable({ accounts }: { accounts: BankSummaryPoint[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bank summary</CardTitle>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No entries linked to a bank account this year.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="p-2 font-medium">Account</th>
                  <th className="p-2 text-right font-medium">Inflow</th>
                  <th className="p-2 text-right font-medium">Outflow</th>
                  <th className="p-2 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr
                    key={account.bankAccountId}
                    data-testid="bank-summary-row"
                    className="border-b last:border-0"
                  >
                    <td className="p-2">{account.name}</td>
                    <td className="p-2 text-right text-emerald-600 tabular-nums dark:text-emerald-400">
                      {formatSGD(account.totalInflowCents)}
                    </td>
                    <td className="p-2 text-right text-red-600 tabular-nums dark:text-red-400">
                      {formatSGD(account.totalOutflowCents)}
                    </td>
                    <td className="p-2 text-right font-semibold tabular-nums">
                      {formatSGD(account.totalInflowCents - account.totalOutflowCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
