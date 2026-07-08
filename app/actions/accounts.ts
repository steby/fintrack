'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { bankAccounts, accountTypeEnum } from '../../lib/db/schema';
import { requireRole } from '../../lib/auth/guards';
import { env } from '../../lib/env';
import { parseAmountToCents, centsToAmount } from '../../lib/money';

export type AccountActionState = { error?: string; success?: boolean } | undefined;

// Unlike lib/money.ts's moneyInputSchema (deliberately non-negative, for budgeted/
// actual amounts), an opening balance may legitimately be negative — spec.md Phase 4
// names "account with negative running balance" as a valid edge case, and a bank
// account can plausibly start there (an overdraft) even before any activity accrues.
// Defaults to '0.00' (the column's own DB default) if the field is omitted.
const openingBalanceSchema = z
  .string()
  .trim()
  .transform((v) => (v === '' ? '0.00' : v))
  .pipe(
    z
      .string()
      // Same false positive as lib/money.ts's own pattern: \d and the literal . never
      // overlap, so there's nothing to backtrack across.
      // eslint-disable-next-line security/detect-unsafe-regex
      .regex(/^-?\d{1,10}(\.\d{1,2})?$/, 'Enter a valid amount (up to 2 decimal places)'),
  )
  .transform(parseAmountToCents);

// Empty string from an unselected <select> means "no link" — distinct from an actual
// UUID. z.literal('') lets the union accept both without a `|| undefined` string dance
// at every call site.
const linkedAccountIdSchema = z.union([z.literal(''), z.string().uuid()]).optional();

async function resolveLinkedAccountId(
  householdId: string,
  raw: string | undefined,
  excludeId?: string,
): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  if (!raw) return { ok: true, value: null };
  if (raw === excludeId) {
    return { ok: false, error: 'An account cannot link to itself.' };
  }
  // Only a real 'bank' account within the SAME household may be linked to — verified
  // here, not just trusted from the form, since the id crosses a trust boundary and a
  // stale/forged id could otherwise reference another household's account (cross-tenant
  // leak) or a same-household 'credit' account (nonsensical: credit cards link to a
  // bank they draw from, not to each other).
  const [linked] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.id, raw),
        eq(bankAccounts.householdId, householdId),
        eq(bankAccounts.accountType, 'bank'),
      ),
    )
    .limit(1);
  if (!linked) {
    return { ok: false, error: 'Linked bank account not found.' };
  }
  return { ok: true, value: raw };
}

const createAccountSchema = z.object({
  name: z.string().trim().min(1, 'Account name is required').max(100),
  accountType: z.enum(accountTypeEnum.enumValues).default('bank'),
  linkedBankAccountId: linkedAccountIdSchema,
  openingBalance: openingBalanceSchema,
});

export async function createAccountAction(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const actingUser = await requireRole('write');

  const openingBalanceProvided = formData.has('openingBalance');
  const parsed = createAccountSchema.safeParse({
    name: formData.get('name'),
    accountType: formData.get('accountType') || undefined,
    linkedBankAccountId: formData.get('linkedBankAccountId') || undefined,
    openingBalance: formData.get('openingBalance') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid account.' };
  }

  // Rejected server-side regardless of whether the UI hides the field when the flag is
  // off (spec.md Phase 4 adversarial: "flags enforced server-side too, not just hidden
  // UI") — a forged submission can't set a real opening balance the household hasn't
  // enabled net-worth tracking for. A submitted-but-zero value is indistinguishable
  // from the column's own default, so it's let through rather than rejected.
  if (openingBalanceProvided && parsed.data.openingBalance !== 0 && !env.FEATURE_NET_WORTH) {
    return { error: 'Net worth tracking is not enabled.' };
  }

  // Only a 'credit' account can link out to a bank account — resolveLinkedAccountId
  // already checks the LINK TARGET's type, but nothing previously checked the SOURCE
  // account's own type, so a plain 'bank' account could end up with a non-null
  // linkedBankAccountId (the exact "nonsensical" case resolveLinkedAccountId's own
  // comment warns about, just from the other direction).
  if (parsed.data.linkedBankAccountId && parsed.data.accountType !== 'credit') {
    return { error: 'Only credit accounts can link to a bank account.' };
  }

  const linked = await resolveLinkedAccountId(
    actingUser.householdId,
    parsed.data.linkedBankAccountId || undefined,
  );
  if (!linked.ok) {
    return { error: linked.error };
  }

  const [{ nextOrder }] = await db
    .select({ nextOrder: sql<number>`coalesce(max(${bankAccounts.sortOrder}), 0) + 1` })
    .from(bankAccounts)
    .where(eq(bankAccounts.householdId, actingUser.householdId));

  await db.insert(bankAccounts).values({
    householdId: actingUser.householdId,
    name: parsed.data.name,
    accountType: parsed.data.accountType,
    linkedBankAccountId: linked.value,
    sortOrder: nextOrder,
    openingBalance: centsToAmount(parsed.data.openingBalance),
  });

  revalidatePath('/settings/categories');
  return { success: true };
}

const updateAccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Account name is required').max(100),
  accountType: z.enum(accountTypeEnum.enumValues).default('bank'),
  linkedBankAccountId: linkedAccountIdSchema,
  openingBalance: openingBalanceSchema,
});

export async function updateAccountAction(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const actingUser = await requireRole('write');

  // Absent (not just empty) means the field wasn't rendered at all — flag off, or this
  // account's current type isn't 'bank' — and the existing stored balance must be left
  // alone, not silently zeroed by a save that never touched it. Distinct from the field
  // being present-but-blank, which optionalMoneyInputSchema-style clearing would treat
  // as a deliberate reset; openingBalanceSchema has no such empty-means-null case
  // (blank always resolves to '0.00'), so this check has to happen before parsing.
  const openingBalanceProvided = formData.has('openingBalance');
  const parsed = updateAccountSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    accountType: formData.get('accountType') || undefined,
    linkedBankAccountId: formData.get('linkedBankAccountId') || undefined,
    openingBalance: formData.get('openingBalance') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid account.' };
  }

  if (openingBalanceProvided && parsed.data.openingBalance !== 0 && !env.FEATURE_NET_WORTH) {
    return { error: 'Net worth tracking is not enabled.' };
  }

  // Same "source must be credit" check as createAccountAction.
  if (parsed.data.linkedBankAccountId && parsed.data.accountType !== 'credit') {
    return { error: 'Only credit accounts can link to a bank account.' };
  }

  const linked = await resolveLinkedAccountId(
    actingUser.householdId,
    parsed.data.linkedBankAccountId || undefined,
    parsed.data.id,
  );
  if (!linked.ok) {
    return { error: linked.error };
  }

  // Changing this account's type away from 'bank' would strand any OTHER account
  // that links to it (a 'credit' account whose linkedBankAccountId now points at a
  // non-bank account) — resolveLinkedAccountId only validates the link at the moment
  // it's CREATED, not retroactively when the target's own type later changes. Reject
  // rather than silently leaving (or cascading a fix into) another account's data.
  if (parsed.data.accountType !== 'bank') {
    const [linkingAccount] = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.linkedBankAccountId, parsed.data.id),
          eq(bankAccounts.householdId, actingUser.householdId),
        ),
      )
      .limit(1);
    if (linkingAccount) {
      return {
        error: 'Cannot change type: another account is linked to this one as its bank account.',
      };
    }
  }

  const result = await db
    .update(bankAccounts)
    .set({
      name: parsed.data.name,
      accountType: parsed.data.accountType,
      linkedBankAccountId: linked.value,
      ...(openingBalanceProvided
        ? { openingBalance: centsToAmount(parsed.data.openingBalance) }
        : {}),
    })
    .where(
      and(
        eq(bankAccounts.id, parsed.data.id),
        eq(bankAccounts.householdId, actingUser.householdId),
      ),
    )
    .returning({ id: bankAccounts.id });

  if (!result[0]) {
    return { error: 'Account not found.' };
  }
  revalidatePath('/settings/categories');
  return { success: true };
}

const deleteAccountSchema = z.object({ id: z.string().uuid() });

export async function deleteAccountAction(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const actingUser = await requireRole('write');

  const parsed = deleteAccountSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  // recurring_schedule.bank_account_id, monthly_entries.bank_account_id, and any OTHER
  // bank_accounts row's linked_bank_account_id all have ON DELETE SET NULL (lib/db/
  // schema.ts) — a single DELETE nullifies every reference atomically.
  const result = await db
    .delete(bankAccounts)
    .where(
      and(
        eq(bankAccounts.id, parsed.data.id),
        eq(bankAccounts.householdId, actingUser.householdId),
      ),
    )
    .returning({ id: bankAccounts.id });

  if (!result[0]) {
    return { error: 'Account not found.' };
  }
  revalidatePath('/settings/categories');
  return { success: true };
}
