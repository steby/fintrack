'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { eq, and } from 'drizzle-orm';
import { db } from '../../lib/db';
import { goals } from '../../lib/db/schema';
import { requireRole, requireConfigFlag } from '../../lib/auth/guards';
import { env } from '../../lib/env';
import { moneyInputSchema, optionalMoneyInputSchema, centsToAmount } from '../../lib/money';

export type GoalActionState = { error?: string; success?: boolean } | undefined;

// Empty string means "no target date" — a goal isn't required to have a deadline.
const targetDateSchema = z.string().refine((v) => {
  if (v === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}, 'Enter a valid date (YYYY-MM-DD)');

const createGoalSchema = z.object({
  name: z.string().trim().min(1, 'Goal name is required').max(100),
  // Non-negative — a target of 0 or less doesn't describe something to save toward.
  targetAmount: moneyInputSchema.refine((v) => v > 0, 'Enter a target amount greater than zero.'),
  savedAmount: optionalMoneyInputSchema,
  targetDate: targetDateSchema,
});

export async function createGoalAction(
  _prevState: GoalActionState,
  formData: FormData,
): Promise<GoalActionState> {
  const actingUser = await requireRole('write');
  // spec.md Phase 4 adversarial: "flag off => zero traces in UI and actions rejected" —
  // this covers a forged request to a household that never enabled goals, independent
  // of whatever the UI does or doesn't show.
  const flagError = requireConfigFlag(env.FEATURE_SAVINGS_GOALS, 'Savings goals are not enabled.');
  if (flagError) return { error: flagError };

  const parsed = createGoalSchema.safeParse({
    name: formData.get('name'),
    targetAmount: formData.get('targetAmount'),
    savedAmount: formData.get('savedAmount') ?? '',
    targetDate: formData.get('targetDate') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid goal.' };
  }

  await db.insert(goals).values({
    householdId: actingUser.householdId,
    name: parsed.data.name,
    targetAmount: centsToAmount(parsed.data.targetAmount),
    savedAmount: centsToAmount(parsed.data.savedAmount ?? 0),
    targetDate: parsed.data.targetDate === '' ? null : parsed.data.targetDate,
  });

  revalidatePath('/goals');
  return { success: true };
}

const updateGoalSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Goal name is required').max(100),
  targetAmount: moneyInputSchema.refine((v) => v > 0, 'Enter a target amount greater than zero.'),
  savedAmount: optionalMoneyInputSchema,
  targetDate: targetDateSchema,
});

export async function updateGoalAction(
  _prevState: GoalActionState,
  formData: FormData,
): Promise<GoalActionState> {
  const actingUser = await requireRole('write');
  // spec.md Phase 4 adversarial: "flag off => zero traces in UI and actions rejected" —
  // this covers a forged request to a household that never enabled goals, independent
  // of whatever the UI does or doesn't show.
  const flagError = requireConfigFlag(env.FEATURE_SAVINGS_GOALS, 'Savings goals are not enabled.');
  if (flagError) return { error: flagError };

  const parsed = updateGoalSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    targetAmount: formData.get('targetAmount'),
    savedAmount: formData.get('savedAmount') ?? '',
    targetDate: formData.get('targetDate') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid goal.' };
  }

  // household_id in the WHERE clause, not just the id — without it, a member could
  // rewrite another household's goal by guessing/reusing a UUID (spec.md threat note:
  // missing household_id filter -> cross-tenant leak).
  const result = await db
    .update(goals)
    .set({
      name: parsed.data.name,
      targetAmount: centsToAmount(parsed.data.targetAmount),
      savedAmount: centsToAmount(parsed.data.savedAmount ?? 0),
      targetDate: parsed.data.targetDate === '' ? null : parsed.data.targetDate,
    })
    .where(and(eq(goals.id, parsed.data.id), eq(goals.householdId, actingUser.householdId)))
    .returning({ id: goals.id });

  if (!result[0]) {
    return { error: 'Goal not found.' };
  }
  revalidatePath('/goals');
  return { success: true };
}

const deleteGoalSchema = z.object({ id: z.string().uuid() });

export async function deleteGoalAction(
  _prevState: GoalActionState,
  formData: FormData,
): Promise<GoalActionState> {
  const actingUser = await requireRole('write');
  // Deliberately NOT gated by FEATURE_SAVINGS_GOALS, unlike create/update — an owner
  // who disabled goals still needs to be able to remove an old one; re-enabling the
  // flag just to delete something would be a needless, confusing detour. Deleting
  // never creates a new trace of the feature the way a create/update write would.

  const parsed = deleteGoalSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  const result = await db
    .delete(goals)
    .where(and(eq(goals.id, parsed.data.id), eq(goals.householdId, actingUser.householdId)))
    .returning({ id: goals.id });

  if (!result[0]) {
    return { error: 'Goal not found.' };
  }
  revalidatePath('/goals');
  return { success: true };
}
