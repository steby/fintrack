'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import {
  recurringSchedule,
  monthlyEntries,
  categories,
  bankAccounts,
  frequencyEnum,
} from '../../lib/db/schema';
import { requireRole } from '../../lib/auth/guards';
import { parseScheduleMonths, walkMonths } from '../../lib/domain/recurring';
import { moneyInputSchema, centsToAmount } from '../../lib/money';
import { generateEntriesForRange } from '../../lib/generate-entries';

export type RecurringActionState = { error?: string; success?: boolean } | undefined;

const uuidOrEmpty = z.union([z.literal(''), z.string().uuid()]).optional();

async function resolveOptionalRef(
  table: typeof categories | typeof bankAccounts,
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

const recurringItemFormSchema = z.object({
  item: z.string().trim().min(1, 'Item name is required').max(200),
  categoryId: uuidOrEmpty,
  budgetedAmount: z.string().optional(),
  bankAccountId: uuidOrEmpty,
  frequency: z.enum(frequencyEnum.enumValues),
  scheduleMonths: z.string().optional(),
  actualDateDay: z.string().optional(),
});

interface ResolvedRecurringInput {
  item: string;
  categoryId: string | null;
  budgetedAmount: string;
  bankAccountId: string | null;
  frequency: (typeof frequencyEnum.enumValues)[number];
  scheduleMonths: string | null;
  actualDateDay: number | null;
}

// Shared by create and update: parses+validates the raw form fields into DB-ready
// values, including cross-tenant reference checks (category/account must belong to the
// acting household) and canonical schedule_months normalization (round-tripped through
// the same parseScheduleMonths that generate() reads back, so what's stored is always
// exactly what would be re-parsed — no drift between validation and storage).
async function resolveRecurringInput(
  householdId: string,
  raw: z.infer<typeof recurringItemFormSchema>,
): Promise<{ ok: true; value: ResolvedRecurringInput } | { ok: false; error: string }> {
  const budgeted = moneyInputSchema.safeParse(raw.budgetedAmount || '0');
  if (!budgeted.success) {
    return { ok: false, error: 'Enter a valid, non-negative budgeted amount.' };
  }

  let scheduleMonths: string | null = null;
  if (raw.frequency !== 'Monthly') {
    const months = parseScheduleMonths(raw.scheduleMonths ?? '');
    if (months.length === 0) {
      return {
        ok: false,
        error: 'Enter valid schedule months (1-12, comma-separated) for a Quarterly/Yearly item.',
      };
    }
    scheduleMonths = months.join(',');
  }

  let actualDateDay: number | null = null;
  if (raw.actualDateDay) {
    // A full-string digit match, not Number.parseInt — parseInt truncates at the first
    // non-digit character ("5xyz" -> 5) instead of rejecting malformed input outright,
    // silently accepting garbage as if it were clean input (unlike every money field in
    // this file, which uses a strict full-match regex for exactly this reason).
    if (!/^\d{1,2}$/.test(raw.actualDateDay)) {
      return { ok: false, error: 'Day of month must be between 1 and 31.' };
    }
    const day = Number.parseInt(raw.actualDateDay, 10);
    if (day < 1 || day > 31) {
      return { ok: false, error: 'Day of month must be between 1 and 31.' };
    }
    actualDateDay = day;
  }

  const category = await resolveOptionalRef(categories, householdId, raw.categoryId);
  if (!category.ok) return { ok: false, error: 'Category not found.' };
  const account = await resolveOptionalRef(bankAccounts, householdId, raw.bankAccountId);
  if (!account.ok) return { ok: false, error: 'Bank account not found.' };

  return {
    ok: true,
    value: {
      item: raw.item,
      categoryId: category.value,
      budgetedAmount: centsToAmount(budgeted.data),
      bankAccountId: account.value,
      frequency: raw.frequency,
      scheduleMonths,
      actualDateDay,
    },
  };
}

// Shared by updateRecurringAction's propagate branch and deleteRecurringAction's
// removeForecast branch: both need exactly "forecast rows for this recurring item that
// haven't been actualized or manually overridden" — lib/domain/entries.ts's
// shouldPropagate expresses this predicate once for unit testing, and this is its SQL
// form, applied directly inside the UPDATE/DELETE's own WHERE clause rather than as a
// separate SELECT followed by a write keyed on the ids it returned. An earlier version
// did exactly that (SELECT candidate ids, filter with shouldPropagate, then act on
// `WHERE id IN (...)`) — a genuine TOCTOU race: a concurrent updateActualAction or
// overrideBudgetAction landing on one of those exact rows between the SELECT and the
// write would still get silently overwritten/deleted, since the write only checked id
// membership, not a fresh predicate. Folding the two conditions directly into the
// WHERE clause makes the read-and-write a single atomic statement instead.
function propagationTargetFilter(recurringScheduleId: string, householdId: string) {
  return and(
    eq(monthlyEntries.recurringScheduleId, recurringScheduleId),
    eq(monthlyEntries.householdId, householdId),
    isNull(monthlyEntries.actualAmount),
    eq(monthlyEntries.isOverridden, false),
  );
}

export async function createRecurringAction(
  _prevState: RecurringActionState,
  formData: FormData,
): Promise<RecurringActionState> {
  const actingUser = await requireRole('write');

  const parsed = recurringItemFormSchema.safeParse({
    item: formData.get('item'),
    categoryId: formData.get('categoryId') || undefined,
    budgetedAmount: formData.get('budgetedAmount') || undefined,
    bankAccountId: formData.get('bankAccountId') || undefined,
    frequency: formData.get('frequency') || undefined,
    scheduleMonths: formData.get('scheduleMonths') || undefined,
    actualDateDay: formData.get('actualDateDay') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid recurring item.' };
  }

  const resolved = await resolveRecurringInput(actingUser.householdId, parsed.data);
  if (!resolved.ok) return { error: resolved.error };

  await db.insert(recurringSchedule).values({
    householdId: actingUser.householdId,
    ...resolved.value,
  });

  revalidatePath('/recurring');
  return { success: true };
}

const updateRecurringFormSchema = recurringItemFormSchema.extend({
  id: z.string().uuid(),
  propagate: z.string().optional(),
});

export async function updateRecurringAction(
  _prevState: RecurringActionState,
  formData: FormData,
): Promise<RecurringActionState> {
  const actingUser = await requireRole('write');

  const parsed = updateRecurringFormSchema.safeParse({
    id: formData.get('id'),
    item: formData.get('item'),
    categoryId: formData.get('categoryId') || undefined,
    budgetedAmount: formData.get('budgetedAmount') || undefined,
    bankAccountId: formData.get('bankAccountId') || undefined,
    frequency: formData.get('frequency') || undefined,
    scheduleMonths: formData.get('scheduleMonths') || undefined,
    actualDateDay: formData.get('actualDateDay') || undefined,
    propagate: formData.get('propagate') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid recurring item.' };
  }

  const resolved = await resolveRecurringInput(actingUser.householdId, parsed.data);
  if (!resolved.ok) return { error: resolved.error };

  const updated = await db
    .update(recurringSchedule)
    .set(resolved.value)
    .where(
      and(
        eq(recurringSchedule.id, parsed.data.id),
        eq(recurringSchedule.householdId, actingUser.householdId),
      ),
    )
    .returning({ id: recurringSchedule.id });

  if (!updated[0]) {
    return { error: 'Recurring item not found.' };
  }

  if (parsed.data.propagate === 'yes') {
    await db
      .update(monthlyEntries)
      .set({
        item: resolved.value.item,
        categoryId: resolved.value.categoryId,
        budgetedAmount: resolved.value.budgetedAmount,
        bankAccountId: resolved.value.bankAccountId,
      })
      .where(propagationTargetFilter(parsed.data.id, actingUser.householdId));
  }

  revalidatePath('/recurring');
  revalidatePath('/monthly');
  return { success: true };
}

const deleteRecurringSchema = z.object({
  id: z.string().uuid(),
  removeForecast: z.string().optional(),
});

export async function deleteRecurringAction(
  _prevState: RecurringActionState,
  formData: FormData,
): Promise<RecurringActionState> {
  const actingUser = await requireRole('write');

  const parsed = deleteRecurringSchema.safeParse({
    id: formData.get('id'),
    removeForecast: formData.get('removeForecast') || undefined,
  });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  if (parsed.data.removeForecast === 'yes') {
    // Only forecast rows (never actualized, never manually overridden) — the same
    // predicate as the propagate branch above. Actualized history for a deleted
    // recurring item stays intact; only its recurring_schedule_id link goes null
    // (ON DELETE SET NULL), matching "never overwrite actualized rows."
    await db
      .delete(monthlyEntries)
      .where(propagationTargetFilter(parsed.data.id, actingUser.householdId));
  }

  const result = await db
    .delete(recurringSchedule)
    .where(
      and(
        eq(recurringSchedule.id, parsed.data.id),
        eq(recurringSchedule.householdId, actingUser.householdId),
      ),
    )
    .returning({ id: recurringSchedule.id });

  if (!result[0]) {
    return { error: 'Recurring item not found.' };
  }
  revalidatePath('/recurring');
  revalidatePath('/monthly');
  return { success: true };
}

const toggleRecurringSchema = z.object({ id: z.string().uuid() });

export async function toggleRecurringAction(
  _prevState: RecurringActionState,
  formData: FormData,
): Promise<RecurringActionState> {
  const actingUser = await requireRole('write');

  const parsed = toggleRecurringSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  // A single atomic UPDATE ... SET is_active = NOT is_active — never reads the current
  // value into the application first, so two concurrent toggle clicks always net out to
  // "flipped exactly twice" (back to the original value), not a lost-update race where
  // both requests read the same starting value and write the same ending value.
  const result = await db
    .update(recurringSchedule)
    .set({ isActive: sql`not ${recurringSchedule.isActive}` })
    .where(
      and(
        eq(recurringSchedule.id, parsed.data.id),
        eq(recurringSchedule.householdId, actingUser.householdId),
      ),
    )
    .returning({ id: recurringSchedule.id });

  if (!result[0]) {
    return { error: 'Recurring item not found.' };
  }
  revalidatePath('/recurring');
  return { success: true };
}

// A generous but bounded cap — prevents a malformed/adversarial date range (e.g. a
// forged form field spanning decades) from generating an unbounded number of rows in
// one request. 120 months (10 years) comfortably covers any real "generate ahead" use.
const MAX_GENERATE_MONTHS = 120;

const generateSchema = z
  .object({
    fromYear: z.coerce.number().int().min(2000).max(2100),
    fromMonth: z.coerce.number().int().min(1).max(12),
    toYear: z.coerce.number().int().min(2000).max(2100),
    toMonth: z.coerce.number().int().min(1).max(12),
  })
  .refine(
    (v) =>
      walkMonths({ year: v.fromYear, month: v.fromMonth }, { year: v.toYear, month: v.toMonth })
        .length <= MAX_GENERATE_MONTHS,
    { message: `Generate at most ${MAX_GENERATE_MONTHS / 12} years at a time.` },
  );

export type GenerateState = { error?: string; success?: boolean; generated?: number } | undefined;

export async function generateAction(
  _prevState: GenerateState,
  formData: FormData,
): Promise<GenerateState> {
  const actingUser = await requireRole('write');

  const parsed = generateSchema.safeParse({
    fromYear: formData.get('fromYear'),
    fromMonth: formData.get('fromMonth'),
    toYear: formData.get('toYear'),
    toMonth: formData.get('toMonth'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid date range.' };
  }

  const generated = await generateEntriesForRange(
    actingUser.householdId,
    { year: parsed.data.fromYear, month: parsed.data.fromMonth },
    { year: parsed.data.toYear, month: parsed.data.toMonth },
  );

  revalidatePath('/monthly');
  return { success: true, generated };
}
