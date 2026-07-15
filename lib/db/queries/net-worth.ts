// Split from lib/db/queries.ts (batch-4 maintainability pass) — see that file's
// barrel comment. Same household-scoping and money-in-cents conventions throughout.
import { db } from '../index';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { monthlyEntries, categories, bankAccounts } from '../schema';
import { parseAmountToCents } from '../../money';
import type { NetWorthAccountInput } from '../../domain/net-worth';

export interface NetWorthAccountRow extends NetWorthAccountInput {
  name: string;
}

// Full account list for the net-worth running-balance walk (spec.md Phase 4) — needs
// type/opening-balance/link fields getDashboardRows's join doesn't select, since that
// query only needs a bank account's *name* for display, not its balance-walk inputs.
// `name` here is for display only (e.g. the dashboard's per-account balances table) —
// lib/domain/net-worth.ts's pure functions only ever consume the NetWorthAccountInput
// subset of this shape.
export async function getAccountsForNetWorth(householdId: string): Promise<NetWorthAccountRow[]> {
  const rows = await db
    .select({
      id: bankAccounts.id,
      name: bankAccounts.name,
      accountType: bankAccounts.accountType,
      openingBalance: bankAccounts.openingBalance,
      linkedBankAccountId: bankAccounts.linkedBankAccountId,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.householdId, householdId));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    accountType: row.accountType,
    openingBalanceCents: parseAmountToCents(row.openingBalance),
    linkedBankAccountId: row.linkedBankAccountId,
  }));
}

export interface NetWorthPriorEntryRow {
  bankAccountId: string | null;
  direction: 'income' | 'expense' | null;
  amountCents: number;
}

// Lifetime carry-forward baseline for net worth (spec.md Phase 4) — everything before
// `year` folded down to one row per (bank_account_id, direction), not one row per
// historical entry. lib/domain/net-worth.ts's sumNetCentsByAccount just adds up signed
// amounts per effective account; feeding it pre-summed groups instead of individual
// entries produces the exact same total (addition is associative — sum-of-sums equals
// sum-of-everything), so that pure function needed no changes at all, only this
// query's shape did. Previously returned one row per entry ever recorded before this
// year — an unboundedly growing fetch+transfer+parse cost this file's own
// warnIfUnusuallyLarge comment already flagged; a household only ever has a handful of
// bank accounts, so this now returns at most 2 rows per account (one per direction)
// regardless of how many years of history exist. No warnIfUnusuallyLarge call here
// anymore — the returned row count no longer reflects entry-history size, so that
// warning's premise (catching unbounded growth) no longer applies to it.
export async function getAccountEntriesBeforeYear(
  householdId: string,
  year: number,
): Promise<NetWorthPriorEntryRow[]> {
  const rows = await db
    .select({
      bankAccountId: monthlyEntries.bankAccountId,
      direction: categories.direction,
      // Mirrors bestEstimateCents' COALESCE(actual_amount, budgeted_amount) pattern —
      // same "best available estimate" rule, just applied per-row before SQL sums
      // rather than in JS after fetching every row (see lib/domain/dashboard.ts's
      // bestEstimateCents doc comment for why this rule exists).
      total: sql<string>`sum(coalesce(${monthlyEntries.actualAmount}, ${monthlyEntries.budgetedAmount}))`,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .where(and(eq(monthlyEntries.householdId, householdId), lt(monthlyEntries.year, year)))
    .groupBy(monthlyEntries.bankAccountId, categories.direction);

  return rows.map((row) => ({
    bankAccountId: row.bankAccountId,
    direction: row.direction,
    amountCents: parseAmountToCents(row.total),
  }));
}

// Lifetime per-account cash position, ACTUALIZED entries only, no year bound — the
// affordability hero's cash lens (spec.md Phase 9 task 1: "Cash = opening balances +
// sumNetCentsByAccount over ACTUALIZED entries only, all years through today"). Same
// grouped-sum shape and reasoning as getAccountEntriesBeforeYear above (one row per
// (bank_account_id, direction) instead of one per entry, so a household's cash position
// is a handful of rows regardless of how many years of history exist) but with a
// `WHERE actual_amount IS NOT NULL` filter instead of a `year <` bound — an unpaid
// forecast row hasn't affected cash yet (see lib/domain/dashboard.ts's actualOnlyCents),
// so it must never be summed here regardless of which year it falls in.
export async function getActualizedCashRows(householdId: string): Promise<NetWorthPriorEntryRow[]> {
  const rows = await db
    .select({
      bankAccountId: monthlyEntries.bankAccountId,
      direction: categories.direction,
      total: sql<string>`sum(${monthlyEntries.actualAmount})`,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .where(and(eq(monthlyEntries.householdId, householdId), isNotNull(monthlyEntries.actualAmount)))
    .groupBy(monthlyEntries.bankAccountId, categories.direction);

  return rows.map((row) => ({
    bankAccountId: row.bankAccountId,
    direction: row.direction,
    amountCents: parseAmountToCents(row.total),
  }));
}
