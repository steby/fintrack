'use client';

import { useActionState, useState } from 'react';
import { updateGoalAction, deleteGoalAction } from '../../actions/goals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
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

  if (isEditing) {
    return (
      <Card data-testid="goal-card">
        <CardContent>
          <form action={updateAction} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={goal.id} />
            <Input name="name" defaultValue={goal.name} required className="h-8" />
            <div className="flex items-center gap-2">
              <Input
                name="targetAmount"
                defaultValue={goal.targetAmount}
                placeholder="Target amount"
                inputMode="decimal"
                required
                className="h-8"
              />
              <Input
                name="savedAmount"
                defaultValue={goal.savedAmount}
                placeholder="Saved so far"
                inputMode="decimal"
                className="h-8"
              />
            </div>
            <Input
              name="targetDate"
              type="date"
              defaultValue={goal.targetDate ?? ''}
              className="h-8"
            />
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
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="goal-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{goal.name}</span>
          {progress.isComplete && (
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              COMPLETE
            </span>
          )}
          {!progress.isComplete && progress.isOverdue && (
            <span className="text-xs font-semibold text-red-600 dark:text-red-400">OVERDUE</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${progress.isComplete ? 'bg-emerald-500' : 'bg-foreground'}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {formatSGD(progress.savedCents)} of {formatSGD(progress.targetCents)}
          </span>
          <span className="font-semibold tabular-nums">{Math.round(progress.percentage)}%</span>
        </div>
        {goal.targetDate && (
          <div className="text-xs text-muted-foreground">Target date: {goal.targetDate}</div>
        )}
        {!progress.isComplete && progress.projectedCompletionDate && (
          <div className="text-xs text-muted-foreground">
            Projected: {progress.projectedCompletionDate}
          </div>
        )}
        {canManage && (
          <div className="mt-2 flex justify-end gap-1">
            {canEdit && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
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
