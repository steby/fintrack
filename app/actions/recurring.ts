'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { eq, and, inArray, sql } from 'drizzle-orm';
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
import { shouldPropagate } from '../../lib/domain/entries';
import { moneyInputSchema, centsToAmount, parseAmountToCents } from '../../lib/money';
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
    const day = Number.parseInt(raw.actualDateDay, 10);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
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
// haven't been actualized or manually overridden" — literally the same predicate,
// so both fetch candidates and filter with the actual tested lib/domain/entries.ts
// function rather than each hand-translating it into a separate SQL WHERE clause that
// could silently drift from what shouldPropagate actually checks.
async function getPropagationTargetIds(
  recurringScheduleId: string,
  householdId: string,
): Promise<string[]> {
  const candidates = await db
    .select({
      id: monthlyEntries.id,
      actualAmount: monthlyEntries.actualAmount,
      isOverridden: monthlyEntries.isOverridden,
    })
    .from(monthlyEntries)
    .where(
      and(
        eq(monthlyEntries.recurringScheduleId, recurringScheduleId),
        eq(monthlyEntries.householdId, householdId),
      ),
    );

  return candidates
    .filter((c) =>
      shouldPropagate({
        actualCents: c.actualAmount === null ? null : parseAmountToCents(c.actualAmount),
        isOverridden: c.isOverridden,
      }),
    )
    .map((c) => c.id);
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
    const targetIds = await getPropagationTargetIds(parsed.data.id, actingUser.householdId);
    if (targetIds.length > 0) {
      await db
        .update(monthlyEntries)
        .set({
          item: resolved.value.item,
          categoryId: resolved.value.categoryId,
          budgetedAmount: resolved.value.budgetedAmount,
          bankAccountId: resolved.value.bankAccountId,
        })
        .where(inArray(monthlyEntries.id, targetIds));
    }
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
    // shouldPropagate-filtered set as the propagate branch above. Actualized history
    // for a deleted recurring item stays intact; only its recurring_schedule_id link
    // goes null (ON DELETE SET NULL), matching "never overwrite actualized rows."
    const targetIds = await getPropagationTargetIds(parsed.data.id, actingUser.householdId);
    if (targetIds.length > 0) {
      await db.delete(monthlyEntries).where(inArray(monthlyEntries.id, targetIds));
    }
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
