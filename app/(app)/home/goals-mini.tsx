import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { computeGoalProgress } from '../../../lib/domain/budgeting';
import { formatSGD } from '../../../lib/format';
import { parseAmountToCents } from '../../../lib/money';

export interface GoalMiniRow {
  id: string;
  name: string;
  targetAmount: string;
  savedAmount: string;
  targetDate: string | null;
  createdAt: Date;
}

// Compact savings-goals card for Home (spec.md Phase 9) — a slimmer read-only rendering
// of app/(app)/goals/goal-card.tsx's own progress math (computeGoalProgress), no
// edit/delete controls (those stay exclusively on /goals — Home is a forecast surface,
// not where goal management happens).
export function GoalsMini({ goals }: { goals: GoalMiniRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Goals</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {goals.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No goals yet.</p>
        ) : (
          goals.map((goal) => {
            const progress = computeGoalProgress(
              parseAmountToCents(goal.savedAmount),
              parseAmountToCents(goal.targetAmount),
              goal.createdAt,
              goal.targetDate === null ? null : new Date(`${goal.targetDate}T00:00:00Z`),
            );
            const barWidth = Math.min(100, progress.percentage);
            return (
              <div key={goal.id} data-testid="goal-mini-row" className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate">{goal.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatSGD(progress.savedCents)} / {formatSGD(progress.targetCents)}
                  </span>
                </div>
                <Progress value={barWidth} />
              </div>
            );
          })
        )}
        <Link
          href="/goals"
          className="self-end text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          See all goals
        </Link>
      </CardContent>
    </Card>
  );
}
