'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { categories, directionEnum } from '../../lib/db/schema';
import { requireRole } from '../../lib/auth/guards';

export type CategoryActionState = { error?: string; success?: boolean } | undefined;

const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #6B7280')
  .default('#6B7280');

const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(100),
  direction: z.enum(directionEnum.enumValues),
  color: colorSchema,
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
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid category.' };
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
  });

  revalidatePath('/settings/categories');
  return { success: true };
}

const updateCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Category name is required').max(100),
  direction: z.enum(directionEnum.enumValues),
  color: colorSchema,
});

export async function updateCategoryAction(
  _prevState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const actingUser = await requireRole('write');

  const parsed = updateCategorySchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    direction: formData.get('direction'),
    color: formData.get('color') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid category.' };
  }

  // household_id in the WHERE clause, not just the id — without it, a member could
  // rewrite another household's category by guessing/reusing a UUID (spec.md threat
  // note: missing household_id filter -> cross-tenant leak).
  const result = await db
    .update(categories)
    .set({ name: parsed.data.name, direction: parsed.data.direction, color: parsed.data.color })
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
  const result = await db
    .delete(categories)
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
