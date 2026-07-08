import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { computeBudgetProgress } from '../../../lib/domain/budgeting';
import { formatSGD } from '../../../lib/format';
import type { CategoryBudgetRow } from '../../../lib/db/queries';

export function BudgetHealthCard({ categories }: { categories: CategoryBudgetRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget health (this month)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {categories.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No categories have a budget cap set yet.
          </div>
        ) : (
          categories.map((c) => {
            const progress = computeBudgetProgress(c.spentCents, c.monthlyBudgetCents);
            const barWidth = Math.min(100, progress.percentage ?? 0);
            return (
              <div
                key={c.categoryId}
                data-testid="budget-health-row"
                className="flex flex-col gap-1"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: c.color }}
                      aria-hidden
                    />
                    {c.name}
                  </span>
                  <span
                    className={
                      progress.isOverCap
                        ? 'font-semibold text-red-600 dark:text-red-400'
                        : 'text-muted-foreground'
                    }
                  >
                    {formatSGD(c.spentCents)} / {formatSGD(c.monthlyBudgetCents ?? 0)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${progress.isOverCap ? 'bg-red-500' : 'bg-emerald-500'}`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
