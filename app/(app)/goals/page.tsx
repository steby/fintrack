import { eq } from 'drizzle-orm';
import { requireUser } from '../../../lib/auth/guards';
import { can } from '../../../lib/auth/rbac';
import { db } from '../../../lib/db';
import { goals } from '../../../lib/db/schema';
import { env } from '../../../lib/env';
import { GoalCard } from './goal-card';
import { GoalAddForm } from './goal-add-form';

export default async function GoalsPage() {
  const user = await requireUser();
  const canManage = can(user.role, 'write');
  const goalsEnabled = env.FEATURE_SAVINGS_GOALS;

  // Server-enforced, not just an absent nav link (spec.md Phase 4 adversarial: "flag
  // off => zero traces in UI [for create/update]"). Deleting is a deliberate exception
  // to that rule, not an oversight: existing goals still render, delete-only, so a
  // household that disables the feature can still clean up old data instead of being
  // forced to re-enable it (a config-flag flip requiring a redeploy) just to remove
  // something. No add form and no edit control either way when the flag is off.
  const allGoals = await db
    .select()
    .from(goals)
    .where(eq(goals.householdId, user.householdId))
    .orderBy(goals.createdAt);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Goals</h1>
        {goalsEnabled ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Track progress toward what the household is saving for.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Savings goals are not enabled. Existing goals can still be removed below.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {allGoals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} canManage={canManage} canEdit={goalsEnabled} />
        ))}
        {allGoals.length === 0 && <p className="text-sm text-muted-foreground">No goals yet.</p>}
      </div>

      {canManage && goalsEnabled && <GoalAddForm />}
    </div>
  );
}
