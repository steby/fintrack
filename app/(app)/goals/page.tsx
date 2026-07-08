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

  // Server-enforced, not just an absent nav link — a household that never enabled
  // this flag gets a plain message instead of the feature, even via a direct URL
  // visit (spec.md Phase 4 adversarial: "flag off => zero traces in UI").
  if (!env.FEATURE_SAVINGS_GOALS) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Goals</h1>
        <p className="mt-2 text-sm text-muted-foreground">Savings goals are not enabled.</p>
      </div>
    );
  }

  const allGoals = await db
    .select()
    .from(goals)
    .where(eq(goals.householdId, user.householdId))
    .orderBy(goals.createdAt);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Goals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track progress toward what the household is saving for.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {allGoals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} canManage={canManage} />
        ))}
        {allGoals.length === 0 && <p className="text-sm text-muted-foreground">No goals yet.</p>}
      </div>

      {canManage && <GoalAddForm />}
    </div>
  );
}
