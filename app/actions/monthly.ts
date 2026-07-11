'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../lib/db';
import { monthlyEntries, categories, bankAccounts, users } from '../../lib/db/schema';
import { requireRole, requireConfigFlag } from '../../lib/auth/guards';
import { env } from '../../lib/env';
import { moneyInputSchema, optionalMoneyInputSchema, centsToAmount } from '../../lib/money';
import { isValidCalendarDate } from '../../lib/domain/month-params';
import { utcStartOfDay } from '../../lib/domain/today';
import { resolveOptionalRef } from '../../lib/db/queries';

export type MonthlyActionState = { error?: string; success?: boolean } | undefined;

const uuidOrEmpty = z.union([z.literal(''), z.string().uuid()]).optional();

// Empty string means "clear the date"; otherwise must be a real YYYY-MM-DD calendar
// date. The regex alone isn't enough — Postgres's own date parsing silently ROLLS OVER
// an out-of-range day instead of rejecting it (e.g. "2026-02-30" becomes 2026-03-02),
// so a shape-only check would let a malformed-but-regex-shaped date land as a
// different, unintended date rather than being rejected. isValidCalendarDate (shared
// with lib/domain/csv.ts's CSV-import date coercion) catches both totally malformed
// strings ("not-a-date", caught by the regex here first) and shape-valid-but-
// nonexistent dates (caught by its ISO round-trip check).
const dateInputSchema = z.string().refine((v) => {
  if (v === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return isValidCalendarDate(v);
}, 'Enter a valid date (YYYY-MM-DD)');

const updateActualSchema = z.object({
  id: z.string().uuid(),
  actualAmount: z.string(),
  actualDate: dateInputSchema,
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
  // Also revalidates Home (Phase 9): this is the exact action markPaidAction's toast
  // Undo replays to restore the pre-mark-paid actualAmount/actualDate, and Home's
  // safe-to-spend/upcoming-list read those same two columns — without this, an Undo
  // triggered from Home would leave its cash figure and list stale until some other
  // navigation happened to revalidate '/'.
  revalidatePath('/');
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

const markPaidSchema = z.object({ id: z.string().uuid() });

export type MarkPaidActionState =
  | { error: string }
  | { success: true; alreadyPaid: true }
  // `previous` carries just enough of the pre-mark-paid state for the client's toast
  // Undo to replay it through the existing updateActualAction (spec.md Phase 9:
  // "Undo restores the exact previous actualAmount/actualDate, including null") — not a
  // separate unmarkPaidAction, since updateActualAction already does exactly "set these
  // two fields," and a second action with the same shape would be pure duplication.
  | {
      success: true;
      alreadyPaid: false;
      previous: { actualAmount: null; actualDate: string | null };
    }
  | undefined;

// One-tap "mark this bill paid" for Home's upcoming list (spec.md Phase 9) — sets
// actualAmount to the entry's own budgetedAmount and actualDate to today (UTC). Double-
// tap safe BY DESIGN, not by accident: an already-paid entry (actualAmount !== null) is
// read back and returned as a no-op (`alreadyPaid: true`) rather than re-running the
// update or erroring — two rapid taps (or a retried request) converge on the same paid
// state instead of silently overwriting a since-edited actual amount/date with the
// budgeted figure a second time.
export async function markPaidAction(
  _prevState: MarkPaidActionState,
  formData: FormData,
): Promise<MarkPaidActionState> {
  const actingUser = await requireRole('write');

  const parsed = markPaidSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  const [entry] = await db
    .select({
      id: monthlyEntries.id,
      actualAmount: monthlyEntries.actualAmount,
      actualDate: monthlyEntries.actualDate,
      budgetedAmount: monthlyEntries.budgetedAmount,
    })
    .from(monthlyEntries)
    .where(
      and(
        eq(monthlyEntries.id, parsed.data.id),
        eq(monthlyEntries.householdId, actingUser.householdId),
      ),
    )
    .limit(1);

  if (!entry) {
    return { error: 'Entry not found.' };
  }

  if (entry.actualAmount !== null) {
    return { success: true, alreadyPaid: true };
  }

  const todayIso = utcStartOfDay().toISOString().slice(0, 10);
  await db
    .update(monthlyEntries)
    .set({ actualAmount: entry.budgetedAmount, actualDate: todayIso })
    .where(eq(monthlyEntries.id, entry.id));

  revalidatePath('/');
  revalidatePath('/monthly');
  // entry.actualAmount is provably null here (the branch above already excluded
  // non-null) — spelled out as the literal `null` rather than `entry.actualAmount` so
  // the return shape's own type (previous.actualAmount: null) is visibly satisfied by
  // construction, not by a value TypeScript merely happens to narrow correctly today.
  return {
    success: true,
    alreadyPaid: false,
    previous: { actualAmount: null, actualDate: entry.actualDate },
  };
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
  // Rejected server-side regardless of whether the UI hides the field when the flag is
  // off (same pattern as categories.ts's monthlyBudget gate) — a forged form submission
  // can't tag an entry with a "who paid" attribution the household hasn't enabled.
  if (parsed.data.paidByUserId) {
    const flagError = requireConfigFlag(
      env.FEATURE_ENTRY_ATTRIBUTION,
      'Entry attribution is not enabled.',
    );
    if (flagError) return { error: flagError };
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
