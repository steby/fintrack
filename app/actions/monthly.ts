'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../lib/db';
import { monthlyEntries, categories, bankAccounts, users } from '../../lib/db/schema';
import { requireRole } from '../../lib/auth/guards';
import { moneyInputSchema, optionalMoneyInputSchema, centsToAmount } from '../../lib/money';

export type MonthlyActionState = { error?: string; success?: boolean } | undefined;

const uuidOrEmpty = z.union([z.literal(''), z.string().uuid()]).optional();

async function resolveOptionalRef(
  table: typeof categories | typeof bankAccounts | typeof users,
  householdId: string,
  raw: string | undefined,
): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  if (!raw) return { ok: true, value: null };
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, raw), eq(table.householdId, householdId)))
    .limit(1);
  if (!row) {
    return { ok: false, error: 'Reference not found.' };
  }
  return { ok: true, value: raw };
}

const updateActualSchema = z.object({
  id: z.string().uuid(),
  actualAmount: z.string(),
  actualDate: z.string(),
});

// Matches the reference app's updateActual action exactly: amount + date only, never
// touches is_overridden. Propagation's safety net (lib/domain/entries.ts's
// shouldPropagate) already excludes actualized rows on its own — actualizing an entry
// here doesn't need to ALSO mark it overridden for that protection to apply.
export async function updateActualAction(
  _prevState: MonthlyActionState,
  formData: FormData,
): Promise<MonthlyActionState> {
  const actingUser = await requireRole('write');

  const parsed = updateActualSchema.safeParse({
    id: formData.get('id'),
    actualAmount: formData.get('actualAmount') ?? '',
    actualDate: formData.get('actualDate') ?? '',
  });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  const amount = optionalMoneyInputSchema.safeParse(parsed.data.actualAmount);
  if (!amount.success) {
    return { error: 'Enter a valid, non-negative actual amount.' };
  }

  const result = await db
    .update(monthlyEntries)
    .set({
      actualAmount: amount.data === null ? null : centsToAmount(amount.data),
      actualDate: parsed.data.actualDate === '' ? null : parsed.data.actualDate,
    })
    .where(
      and(
        eq(monthlyEntries.id, parsed.data.id),
        eq(monthlyEntries.householdId, actingUser.householdId),
      ),
    )
    .returning({ id: monthlyEntries.id });

  if (!result[0]) {
    return { error: 'Entry not found.' };
  }
  revalidatePath('/monthly');
  return { success: true };
}

const overrideBudgetSchema = z.object({
  id: z.string().uuid(),
  budgetedAmount: z.string(),
});

// A Phase 2 expansion beyond the reference app (which never let a forecast month's
// budgeted amount diverge from its recurring template except via propagate): lets a
// single forecast month be corrected in place — e.g. "rent goes up temporarily this
// month" — without waiting for an actual. Setting is_overridden = true here is what
// makes lib/domain/entries.ts's shouldPropagate skip this row on a later recurring-item
// propagate, so that edit doesn't silently clobber this one-off correction.
export async function overrideBudgetAction(
  _prevState: MonthlyActionState,
  formData: FormData,
): Promise<MonthlyActionState> {
  const actingUser = await requireRole('write');

  const parsed = overrideBudgetSchema.safeParse({
    id: formData.get('id'),
    budgetedAmount: formData.get('budgetedAmount'),
  });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  const amount = moneyInputSchema.safeParse(parsed.data.budgetedAmount);
  if (!amount.success) {
    return { error: 'Enter a valid, non-negative budgeted amount.' };
  }

  const result = await db
    .update(monthlyEntries)
    .set({ budgetedAmount: centsToAmount(amount.data), isOverridden: true })
    .where(
      and(
        eq(monthlyEntries.id, parsed.data.id),
        eq(monthlyEntries.householdId, actingUser.householdId),
      ),
    )
    .returning({ id: monthlyEntries.id });

  if (!result[0]) {
    return { error: 'Entry not found.' };
  }
  revalidatePath('/monthly');
  return { success: true };
}

const addAdhocSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  item: z.string().trim().min(1, 'Item name is required').max(200),
  categoryId: uuidOrEmpty,
  budgetedAmount: z.string().optional(),
  actualAmount: z.string().optional(),
  bankAccountId: uuidOrEmpty,
  paidByUserId: uuidOrEmpty,
});

export async function addAdhocAction(
  _prevState: MonthlyActionState,
  formData: FormData,
): Promise<MonthlyActionState> {
  const actingUser = await requireRole('write');

  const parsed = addAdhocSchema.safeParse({
    year: formData.get('year'),
    month: formData.get('month'),
    item: formData.get('item'),
    categoryId: formData.get('categoryId') || undefined,
    budgetedAmount: formData.get('budgetedAmount') || undefined,
    actualAmount: formData.get('actualAmount') || undefined,
    bankAccountId: formData.get('bankAccountId') || undefined,
    paidByUserId: formData.get('paidByUserId') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid entry.' };
  }

  const budgeted = moneyInputSchema.safeParse(parsed.data.budgetedAmount || '0');
  if (!budgeted.success) {
    return { error: 'Enter a valid, non-negative budgeted amount.' };
  }
  const actual = optionalMoneyInputSchema.safeParse(parsed.data.actualAmount || '');
  if (!actual.success) {
    return { error: 'Enter a valid, non-negative actual amount.' };
  }

  const category = await resolveOptionalRef(
    categories,
    actingUser.householdId,
    parsed.data.categoryId,
  );
  if (!category.ok) return { error: 'Category not found.' };
  const account = await resolveOptionalRef(
    bankAccounts,
    actingUser.householdId,
    parsed.data.bankAccountId,
  );
  if (!account.ok) return { error: 'Bank account not found.' };
  const paidBy = await resolveOptionalRef(users, actingUser.householdId, parsed.data.paidByUserId);
  if (!paidBy.ok) return { error: 'Household member not found.' };

  await db.insert(monthlyEntries).values({
    householdId: actingUser.householdId,
    year: parsed.data.year,
    month: parsed.data.month,
    item: parsed.data.item,
    categoryId: category.value,
    budgetedAmount: centsToAmount(budgeted.data),
    actualAmount: actual.data === null ? null : centsToAmount(actual.data),
    bankAccountId: account.value,
    paidByUserId: paidBy.value,
  });

  revalidatePath('/monthly');
  return { success: true };
}

const deleteEntrySchema = z.object({ id: z.string().uuid() });

export async function deleteEntryAction(
  _prevState: MonthlyActionState,
  formData: FormData,
): Promise<MonthlyActionState> {
  const actingUser = await requireRole('write');

  const parsed = deleteEntrySchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  // recurring_schedule_id IS NULL restricts this to ad-hoc entries only — the reference
  // app only hid the delete button in the UI for recurring-generated entries but never
  // enforced it server-side, so a forged request could delete a generated forecast
  // month directly (bypassing the recurring item's own removeForecast path and its
  // "never touch actualized rows" guard). Enforced here instead of just in the UI.
  const result = await db
    .delete(monthlyEntries)
    .where(
      and(
        eq(monthlyEntries.id, parsed.data.id),
        eq(monthlyEntries.householdId, actingUser.householdId),
        isNull(monthlyEntries.recurringScheduleId),
      ),
    )
    .returning({ id: monthlyEntries.id });

  if (!result[0]) {
    return { error: 'Entry not found.' };
  }
  revalidatePath('/monthly');
  return { success: true };
}
