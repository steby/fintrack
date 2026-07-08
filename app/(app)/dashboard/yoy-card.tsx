import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatSGD } from '../../../lib/format';
import type { YoyDelta } from '../../../lib/domain/dashboard';

function DeltaBadge({ percent, invert }: { percent: number | null; invert: boolean }) {
  if (percent === null) {
    return <span className="text-xs text-muted-foreground">no prior year</span>;
  }

  // Round first, then branch on the rounded value — otherwise a tiny negative delta
  // that rounds to "0.0" still reads as unfavorable/red with a stray "-0.0%" sign,
  // which looks like a real move when the two years are effectively flat.
  const rounded = Math.round(percent * 10) / 10;
  if (rounded === 0) {
    return <span className="text-xs font-semibold text-muted-foreground">0.0%</span>;
  }
  // For expense, a smaller number is favorable — invert which sign renders green/red.
  const favorable = invert ? rounded <= 0 : rounded >= 0;
  const color = favorable
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400';
  return (
    <span className={`text-xs font-semibold ${color}`}>
      {rounded > 0 ? '+' : ''}
      {rounded.toFixed(1)}%
    </span>
  );
}

export function YoyCard({ yoy, priorYear }: { yoy: YoyDelta; priorYear: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Year over year (vs. {priorYear})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Income
            </div>
            <div className="text-lg font-bold tabular-nums">{formatSGD(yoy.incomeCents)}</div>
            <DeltaBadge percent={yoy.incomePercent} invert={false} />
          </div>
          <div>
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Expense
            </div>
            <div className="text-lg font-bold tabular-nums">{formatSGD(yoy.expenseCents)}</div>
            <DeltaBadge percent={yoy.expensePercent} invert={true} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
