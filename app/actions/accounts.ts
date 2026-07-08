'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { bankAccounts, accountTypeEnum } from '../../lib/db/schema';
import { requireRole } from '../../lib/auth/guards';

export type AccountActionState = { error?: string; success?: boolean } | undefined;

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
});

export async function createAccountAction(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const actingUser = await requireRole('write');

  const parsed = createAccountSchema.safeParse({
    name: formData.get('name'),
    accountType: formData.get('accountType') || undefined,
    linkedBankAccountId: formData.get('linkedBankAccountId') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid account.' };
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
  });

  revalidatePath('/settings/categories');
  return { success: true };
}

const updateAccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Account name is required').max(100),
  accountType: z.enum(accountTypeEnum.enumValues).default('bank'),
  linkedBankAccountId: linkedAccountIdSchema,
});

export async function updateAccountAction(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const actingUser = await requireRole('write');

  const parsed = updateAccountSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    accountType: formData.get('accountType') || undefined,
    linkedBankAccountId: formData.get('linkedBankAccountId') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid account.' };
  }

  const linked = await resolveLinkedAccountId(
    actingUser.householdId,
    parsed.data.linkedBankAccountId || undefined,
    parsed.data.id,
  );
  if (!linked.ok) {
    return { error: linked.error };
  }

  const result = await db
    .update(bankAccounts)
    .set({
      name: parsed.data.name,
      accountType: parsed.data.accountType,
      linkedBankAccountId: linked.value,
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
