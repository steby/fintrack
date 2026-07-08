import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatSGD } from '../../../lib/format';
import type { FixedVsVariable } from '../../../lib/domain/dashboard';

export function FixedVariableCard({ data }: { data: FixedVsVariable }) {
  const total = data.fixedExpenseCents + data.variableExpenseCents;
  const fixedPercent = total > 0 ? Math.round((data.fixedExpenseCents / total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fixed vs. variable</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {total === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No expenses recorded this year.
          </div>
        ) : (
          <>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-foreground" style={{ width: `${fixedPercent}%` }} />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Fixed (recurring)</span>
              <span className="font-semibold tabular-nums">
                {formatSGD(data.fixedExpenseCents)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Variable (ad-hoc)</span>
              <span className="font-semibold tabular-nums">
                {formatSGD(data.variableExpenseCents)}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
