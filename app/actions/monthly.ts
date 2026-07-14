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
import { resolveOptionalRef, getOrCreateUncategorizedCategoryId } from '../../lib/db/queries';

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

const updateEntryDetailsSchema = z.object({
  id: z.string().uuid(),
  item: z.string().trim().min(1, 'Item name is required').max(200),
  categoryId: uuidOrEmpty,
  actualAmount: z.string(),
  actualDate: dateInputSchema,
});

// The edit-entry sheet's one-submit action (full-app-review finding N1: ad-hoc entries
// had NO edit path at all after creation — not even to assign a category, which made
// the categorize nudge a dead end). Edits item name, category, and the actual
// amount/date together. Amount/date semantics mirror updateActualAction exactly
// (empty string clears to null); category '' means the reserved Uncategorized
// category, same mapping quick-add uses.
export async function updateEntryDetailsAction(
  _prevState: MonthlyActionState,
  formData: FormData,
): Promise<MonthlyActionState> {
  const actingUser = await requireRole('write');

  const parsed = updateEntryDetailsSchema.safeParse({
    id: formData.get('id'),
    item: formData.get('item'),
    categoryId: formData.get('categoryId') || undefined,
    actualAmount: formData.get('actualAmount') ?? '',
    actualDate: formData.get('actualDate') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid request.' };
  }

  const amount = optionalMoneyInputSchema.safeParse(parsed.data.actualAmount);
  if (!amount.success) {
    return { error: 'Enter a valid, non-negative actual amount.' };
  }

  const [entry] = await db
    .select({ item: monthlyEntries.item, recurringScheduleId: monthlyEntries.recurringScheduleId })
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

  // A recurring-generated entry's name belongs to its Plan template — renaming one
  // month's instance here would be silently clobbered by the next propagate (and
  // desyncs the other months). The sheet disables the field for these rows; this is
  // the server-side backstop for a forged post.
  if (entry.recurringScheduleId !== null && parsed.data.item !== entry.item) {
    return { error: 'This entry comes from a recurring item — rename it on the Plan page.' };
  }

  const category = await resolveOptionalRef(
    categories,
    actingUser.householdId,
    parsed.data.categoryId,
  );
  if (!category.ok) return { error: 'Category not found.' };
  const categoryId =
    category.value ?? (await getOrCreateUncategorizedCategoryId(actingUser.householdId));

  await db
    .update(monthlyEntries)
    .set({
      item: parsed.data.item,
      categoryId,
      actualAmount: amount.data === null ? null : centsToAmount(amount.data),
      actualDate: parsed.data.actualDate === '' ? null : parsed.data.actualDate,
    })
    .where(
      and(
        eq(monthlyEntries.id, parsed.data.id),
        eq(monthlyEntries.householdId, actingUser.householdId),
      ),
    );

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
  // Also revalidates Home (post-redesign bug-fix pass): a category-budget override
  // changes this month's budgetedAmount, which Home's budget-remaining lens
  // (computeBudgetRemaining, fed by getDashboardRowsForMonth) reads directly — without
  // this, Home would show a stale figure until some other navigation happened to
  // revalidate '/'. Same pattern as updateActualAction's and markPaidAction's own
  // revalidatePath('/') just above/below.
  revalidatePath('/');
  revalidatePath('/monthly');
  return { success: true };
}

const markPaidSchema = z.object({
  id: z.string().uuid(),
  // Optional (post-redesign bug-fix pass — USER'S EXPLICIT SPEC: let the user correct
  // the date before it's recorded, since Phase 10 made this button reachable from
  // arbitrary past/future months via Monthly's chevrons, not just "today"). Reuses the
  // existing dateInputSchema (same calendar-impossible-date rejection, same
  // empty-string convention) rather than inventing a second date validator.
  // Empty/absent defaults to today (UTC) server-side below — defense in depth against
  // a stripped/missing field, not just relying on the client's own default.
  actualDate: dateInputSchema.optional(),
  // Optional (full-app-review item 8): real bills vary from their budgeted figure —
  // utilities especially — and the confirm sheet is the moment the user has the real
  // number in hand. Empty/absent falls back to the budgeted amount (the original
  // one-tap behavior, unchanged).
  actualAmount: z.string().optional(),
});

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

// "Mark this bill paid" for Home's upcoming list (spec.md Phase 9) — sets actualAmount
// to the entry's own budgetedAmount and actualDate to the given date, defaulting
// server-side to today (UTC) if omitted/blank (post-redesign bug-fix pass: the client
// popup — mark-paid-button.tsx — always sends an explicit date now, defaulting to
// TODAY but user-editable, since this button is reachable from arbitrary past/future
// months via Monthly's chevrons, not just "today"; this server-side default is defense
// in depth for a stripped/missing field, not the primary source of the date). Double-
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

  const parsed = markPaidSchema.safeParse({
    id: formData.get('id'),
    actualDate: formData.get('actualDate') || undefined,
    actualAmount: formData.get('actualAmount') || undefined,
  });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  const overrideAmount = optionalMoneyInputSchema.safeParse(parsed.data.actualAmount ?? '');
  if (!overrideAmount.success) {
    return { error: 'Enter a valid, non-negative amount.' };
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

  const actualDate =
    parsed.data.actualDate && parsed.data.actualDate !== ''
      ? parsed.data.actualDate
      : utcStartOfDay().toISOString().slice(0, 10);
  await db
    .update(monthlyEntries)
    .set({
      actualAmount:
        overrideAmount.data === null ? entry.budgetedAmount : centsToAmount(overrideAmount.data),
      actualDate,
    })
    .where(
      and(eq(monthlyEntries.id, entry.id), eq(monthlyEntries.householdId, actingUser.householdId)),
    );

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
  // Optional (Phase 10's global quick-add — spec.md: "fields Item, Amount (actual),
  // Category, Account, Date"): when a quick-add records something that already
  // happened, the date it happened is worth capturing alongside the actual amount, the
  // same pair updateActualAction already treats as a unit. Reuses dateInputSchema
  // (below) rather than inventing a second date validator — same calendar-impossible-
  // date rejection (e.g. "2026-02-30"), same empty-string-means-"no date" convention.
  actualDate: dateInputSchema.optional(),
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
    actualDate: formData.get('actualDate') || undefined,
    bankAccountId: formData.get('bankAccountId') || undefined,
    paidByUserId: formData.get('paidByUserId') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid entry.' };
  }

  const actual = optionalMoneyInputSchema.safeParse(parsed.data.actualAmount || '');
  if (!actual.success) {
    return { error: 'Enter a valid, non-negative actual amount.' };
  }
  // Quick-add's primary flow (spec.md Phase 10) only exposes ONE visible "Amount" field
  // (bound to actualAmount — logging something that already happened), with a
  // budgeted-vs-actual split available only behind "More options". If that field is
  // left blank while an actual amount WAS given, default budgeted to the same value
  // rather than 0 — a quick-logged $50 lunch with no explicit budget shouldn't register
  // as "$50 over budget" by default (entry-row.tsx's Difference column would otherwise
  // show a misleading swing for the common case). Leaving BOTH amount fields blank
  // still defaults budgeted to 0, unchanged from the original ad-hoc-form behavior (a
  // pure, not-yet-happened forecast row with nothing spent yet).
  const budgetedRaw =
    parsed.data.budgetedAmount ||
    (actual.data !== null ? parsed.data.actualAmount : undefined) ||
    '0';
  const budgeted = moneyInputSchema.safeParse(budgetedRaw);
  if (!budgeted.success) {
    return { error: 'Enter a valid, non-negative budgeted amount.' };
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

  // No category picked → the household's reserved Uncategorized (expense) category, so
  // the entry has a direction and therefore COUNTS. A truly category-less entry is
  // excluded from every total, forecast, and chart (direction is unknowable), which
  // made quick-add's fastest path produce entries that changed no number anywhere —
  // full-app-review finding, live-demonstrated with a $123.45 add that moved nothing.
  const categoryId =
    category.value ?? (await getOrCreateUncategorizedCategoryId(actingUser.householdId));

  await db.insert(monthlyEntries).values({
    householdId: actingUser.householdId,
    year: parsed.data.year,
    month: parsed.data.month,
    item: parsed.data.item,
    categoryId,
    budgetedAmount: centsToAmount(budgeted.data),
    actualAmount: actual.data === null ? null : centsToAmount(actual.data),
    actualDate: parsed.data.actualDate ? parsed.data.actualDate : null,
    bankAccountId: account.value,
    paidByUserId: paidBy.value,
  });

  // Also revalidates Home (post-redesign bug-fix pass): a quick-added entry can land
  // in the CURRENT month (e.g. an actualAmount logged today), which Home's
  // upcoming-list/safe-to-spend/budget-remaining figures all depend on — without this,
  // Home would show stale data until some other navigation happened to revalidate '/'.
  // Same pattern as updateActualAction's/markPaidAction's own revalidatePath('/').
  revalidatePath('/');
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
  // Also revalidates Home (post-redesign bug-fix pass): a deleted ad-hoc entry can be
  // one Home is currently counting toward its upcoming list/safe-to-spend/
  // budget-remaining figures — without this, Home would keep showing it until some
  // other navigation happened to revalidate '/'. Same pattern as updateActualAction's/
  // markPaidAction's own revalidatePath('/').
  revalidatePath('/');
  revalidatePath('/monthly');
  return { success: true };
}
