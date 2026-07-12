'use client';

import { useActionState, useState } from 'react';
import { updateGoalAction, deleteGoalAction } from '../../actions/goals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { computeGoalProgress } from '../../../lib/domain/budgeting';
import { formatSGD } from '../../../lib/format';
import { parseAmountToCents } from '../../../lib/money';

export interface Goal {
  id: string;
  name: string;
  targetAmount: string;
  savedAmount: string;
  targetDate: string | null;
  createdAt: Date;
}

export function GoalCard({
  goal,
  canManage,
  canEdit,
}: {
  goal: Goal;
  canManage: boolean;
  canEdit: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(updateGoalAction, undefined);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteGoalAction, undefined);

  // Render-time state sync (not useEffect+setState — see category-row.tsx for why):
  // closing the edit sheet only touches THIS component's own local state, so the same
  // pattern quick-add.tsx and goal-add-form.tsx use is safe here too.
  const [reactedTo, setReactedTo] = useState(updateState);
  if (updateState !== reactedTo) {
    setReactedTo(updateState);
    if (updateState?.success) setIsEditing(false);
  }

  const progress = computeGoalProgress(
    parseAmountToCents(goal.savedAmount),
    parseAmountToCents(goal.targetAmount),
    goal.createdAt,
    goal.targetDate === null ? null : new Date(`${goal.targetDate}T00:00:00Z`),
  );
  const barWidth = Math.min(100, progress.percentage);

  return (
    <Card data-testid="goal-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{goal.name}</span>
          {progress.isComplete && (
            <Badge className="border-transparent bg-income/15 text-income">COMPLETE</Badge>
          )}
          {!progress.isComplete && progress.isOverdue && (
            <Badge className="border-transparent bg-warning/15 text-warning">OVERDUE</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Progress
          value={barWidth}
          indicatorClassName={progress.isComplete ? 'bg-income' : undefined}
        />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {formatSGD(progress.savedCents)} of {formatSGD(progress.targetCents)}
          </span>
          <span className="font-semibold tabular-nums">{Math.round(progress.percentage)}%</span>
        </div>
        {goal.targetDate && (
          <div className="text-xs text-muted-foreground">Target date: {goal.targetDate}</div>
        )}
        {/* Projected-completion badge (spec.md Phase 11 task 2) — only ever shown
            alongside a non-complete goal that has some savings history to project
            from (computeGoalProgress returns null otherwise), so it never overlaps
            with the COMPLETE badge above. */}
        {!progress.isComplete && progress.projectedCompletionDate && (
          <Badge variant="secondary" className="w-fit">
            Projected {progress.projectedCompletionDate}
          </Badge>
        )}
        {canManage && (
          <div className="mt-1 flex justify-end gap-1">
            {canEdit && (
              <ResponsiveSheet
                open={isEditing}
                onOpenChange={setIsEditing}
                title="Edit goal"
                trigger={
                  <Button type="button" variant="ghost" size="sm">
                    Edit
                  </Button>
                }
              >
                <form
                  action={updateAction}
                  data-testid="goal-edit-form"
                  className="flex flex-col gap-3"
                >
                  <input type="hidden" name="id" value={goal.id} />
                  <label className="flex flex-col gap-1 text-sm">
                    Name
                    <Input name="name" defaultValue={goal.name} required />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-sm">
                      Target amount
                      <Input
                        name="targetAmount"
                        defaultValue={goal.targetAmount}
                        placeholder="Target amount"
                        inputMode="decimal"
                        required
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Saved so far
                      <Input
                        name="savedAmount"
                        defaultValue={goal.savedAmount}
                        placeholder="Saved so far"
                        inputMode="decimal"
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-sm">
                    Target date
                    <Input name="targetDate" type="date" defaultValue={goal.targetDate ?? ''} />
                  </label>
                  <Button type="submit" disabled={updatePending}>
                    {updatePending ? 'Saving…' : 'Save'}
                  </Button>
                  {updateState?.error && (
                    <p className="text-xs text-destructive">{updateState.error}</p>
                  )}
                </form>
              </ResponsiveSheet>
            )}
            <form action={deleteAction}>
              <input type="hidden" name="id" value={goal.id} />
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
        {deleteState?.error && <p className="text-xs text-destructive">{deleteState.error}</p>}
      </CardContent>
    </Card>
  );
}
