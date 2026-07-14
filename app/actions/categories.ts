'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { categories, directionEnum } from '../../lib/db/schema';
import { requireRole, requireConfigFlag } from '../../lib/auth/guards';
import { env } from '../../lib/env';
import { optionalMoneyInputSchema, centsToAmount } from '../../lib/money';

export type CategoryActionState = { error?: string; success?: boolean } | undefined;

const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #6B7280')
  .default('#6B7280');

// Empty string means "no cap set" (null) — distinct from a cap explicitly set to 0
// (spec.md Phase 4: "budget of 0 vs null, unset ≠ zero cap"). optionalMoneyInputSchema
// already treats '' as null and rejects negative amounts.
const monthlyBudgetSchema = optionalMoneyInputSchema;

const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(100),
  direction: z.enum(directionEnum.enumValues),
  color: colorSchema,
  monthlyBudget: monthlyBudgetSchema,
});

export async function createCategoryAction(
  _prevState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const actingUser = await requireRole('write');

  const parsed = createCategorySchema.safeParse({
    name: formData.get('name'),
    direction: formData.get('direction'),
    color: formData.get('color') || undefined,
    monthlyBudget: formData.get('monthlyBudget') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid category.' };
  }
  // Rejected server-side regardless of whether the UI hides the field when the flag is
  // off (spec.md Phase 4 adversarial: "flags enforced server-side too, not just hidden
  // UI") — a forged form submission can't set a budget cap the household hasn't
  // enabled.
  if (parsed.data.monthlyBudget !== null) {
    const flagError = requireConfigFlag(
      env.FEATURE_CATEGORY_BUDGETS,
      'Category budgets are not enabled.',
    );
    if (flagError) return { error: flagError };
  }
  // A budget cap only means anything against expense entries (getCurrentMonthCategoryBudgets
  // only ever looks at direction: 'expense' categories) — reject rather than silently
  // store an inert value on an income category.
  if (parsed.data.monthlyBudget !== null && parsed.data.direction !== 'expense') {
    return { error: 'Only expense categories can have a budget cap.' };
  }

  // Next sort position within this household only — matches the reference app's
  // MAX(sort_order)+1 pattern, now scoped by household_id instead of global. Two
  // concurrent adds could tie on the same position (a benign race — worst case is
  // cosmetic ordering, not data loss), same tradeoff the original app accepted.
  const [{ nextOrder }] = await db
    .select({ nextOrder: sql<number>`coalesce(max(${categories.sortOrder}), 0) + 1` })
    .from(categories)
    .where(eq(categories.householdId, actingUser.householdId));

  await db.insert(categories).values({
    householdId: actingUser.householdId,
    name: parsed.data.name,
    direction: parsed.data.direction,
    color: parsed.data.color,
    sortOrder: nextOrder,
    monthlyBudget:
      parsed.data.monthlyBudget === null ? null : centsToAmount(parsed.data.monthlyBudget),
  });

  revalidatePath('/settings/categories');
  return { success: true };
}

const updateCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Category name is required').max(100),
  direction: z.enum(directionEnum.enumValues),
  color: colorSchema,
  monthlyBudget: monthlyBudgetSchema,
});

export async function updateCategoryAction(
  _prevState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const actingUser = await requireRole('write');

  // Absent (not just empty) means the field wasn't rendered at all — flag off, or an
  // income category, where category-row.tsx never shows the budget input — and the
  // existing cap must be left alone, not silently cleared by a save that never touched
  // it. Distinct from the field being present-but-blank (flag on, an expense category,
  // user deliberately clears it), which optionalMoneyInputSchema correctly treats as
  // "clear the cap" — that case still needs to reach the database as monthlyBudget: null.
  const monthlyBudgetProvided = formData.has('monthlyBudget');
  const parsed = updateCategorySchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    direction: formData.get('direction'),
    color: formData.get('color') || undefined,
    monthlyBudget: formData.get('monthlyBudget') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid category.' };
  }
  if (parsed.data.monthlyBudget !== null) {
    const flagError = requireConfigFlag(
      env.FEATURE_CATEGORY_BUDGETS,
      'Category budgets are not enabled.',
    );
    if (flagError) return { error: flagError };
  }
  if (parsed.data.monthlyBudget !== null && parsed.data.direction !== 'expense') {
    return { error: 'Only expense categories can have a budget cap.' };
  }

  // The reserved Uncategorized category must stay expense-direction — flipping it to
  // income (only reachable via a forged post; the UI's direction is a hidden input)
  // would make every quick-added uncategorized spend COUNT AS INCOME. Rename/color/cap
  // stay editable on it; only direction is pinned.
  if (parsed.data.direction !== 'expense') {
    const [systemRow] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, parsed.data.id),
          eq(categories.householdId, actingUser.householdId),
          eq(categories.isSystem, true),
        ),
      )
      .limit(1);
    if (systemRow) {
      return { error: 'The built-in Uncategorized category must stay an expense category.' };
    }
  }

  // household_id in the WHERE clause, not just the id — without it, a member could
  // rewrite another household's category by guessing/reusing a UUID (spec.md threat
  // note: missing household_id filter -> cross-tenant leak).
  const result = await db
    .update(categories)
    .set({
      name: parsed.data.name,
      direction: parsed.data.direction,
      color: parsed.data.color,
      ...(monthlyBudgetProvided
        ? {
            monthlyBudget:
              parsed.data.monthlyBudget === null ? null : centsToAmount(parsed.data.monthlyBudget),
          }
        : {}),
    })
    .where(
      and(eq(categories.id, parsed.data.id), eq(categories.householdId, actingUser.householdId)),
    )
    .returning({ id: categories.id });

  if (!result[0]) {
    return { error: 'Category not found.' };
  }
  revalidatePath('/settings/categories');
  return { success: true };
}

const deleteCategorySchema = z.object({ id: z.string().uuid() });

export async function deleteCategoryAction(
  _prevState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const actingUser = await requireRole('write');

  const parsed = deleteCategorySchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  // recurring_schedule.category_id and monthly_entries.category_id both have
  // ON DELETE SET NULL (lib/db/schema.ts) — Postgres nullifies every reference to this
  // category as part of this single DELETE, atomically, instead of the reference app's
  // manual two-step "UPDATE ... SET category_id = NULL" before the delete.
  // is_system = false in the WHERE (not a UI-only guard): the reserved Uncategorized
  // category must survive even a forged form post — deleting it would SET NULL its
  // entries back outside every total and fight getOrCreateUncategorizedCategoryId's
  // self-heal.
  const result = await db
    .delete(categories)
    .where(
      and(
        eq(categories.id, parsed.data.id),
        eq(categories.householdId, actingUser.householdId),
        eq(categories.isSystem, false),
      ),
    )
    .returning({ id: categories.id });

  if (!result[0]) {
    // Distinguish "doesn't exist" from "exists but reserved" — the row IS visible in
    // the UI (which hides its Delete button), so a plain not-found would be confusing
    // for anyone probing it directly.
    const [systemRow] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, parsed.data.id),
          eq(categories.householdId, actingUser.householdId),
          eq(categories.isSystem, true),
        ),
      )
      .limit(1);
    return {
      error: systemRow
        ? 'The built-in Uncategorized category can’t be deleted.'
        : 'Category not found.',
    };
  }
  revalidatePath('/settings/categories');
  return { success: true };
}
