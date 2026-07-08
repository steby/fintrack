import { Card, CardContent } from '@/components/ui/card';
import { formatSGD } from '../../../lib/format';
import type { YearTotals } from '../../../lib/domain/dashboard';

function Tile({
  label,
  budgeted,
  actual,
  tone,
}: {
  label: string;
  budgeted: number;
  actual: number;
  tone: 'income' | 'expense' | 'neutral';
}) {
  const actualColor =
    tone === 'income'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'expense'
        ? 'text-red-600 dark:text-red-400'
        : actual >= 0
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-600 dark:text-red-400';

  return (
    <Card>
      <CardContent>
        <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </div>
        <div className={`text-xl font-bold tabular-nums ${actualColor}`}>{formatSGD(actual)}</div>
        <div className="text-xs text-muted-foreground">Budgeted {formatSGD(budgeted)}</div>
      </CardContent>
    </Card>
  );
}

export function StatTiles({ totals }: { totals: YearTotals }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Tile
        label="Income"
        budgeted={totals.budgetedIncomeCents}
        actual={totals.actualIncomeCents}
        tone="income"
      />
      <Tile
        label="Expense"
        budgeted={totals.budgetedExpenseCents}
        actual={totals.actualExpenseCents}
        tone="expense"
      />
      <Tile
        label="Net"
        budgeted={totals.netBudgetedCents}
        actual={totals.netActualCents}
        tone="neutral"
      />
      <Card>
        <CardContent>
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Savings rate
          </div>
          <div className="text-xl font-bold tabular-nums">
            {totals.actualIncomeCents > 0
              ? `${Math.round((totals.netActualCents / totals.actualIncomeCents) * 100)}%`
              : '—'}
          </div>
          <div className="text-xs text-muted-foreground">Actual net &divide; actual income</div>
        </CardContent>
      </Card>
    </div>
  );
}
