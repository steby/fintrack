import { and, eq, lt } from 'drizzle-orm';
import { db } from './index';
import { monthlyEntries, categories, bankAccounts, recurringSchedule } from './schema';
import { parseAmountToCents } from '../money';
import { bestEstimateCents, type DashboardEntryRow } from '../domain/dashboard';
import type { NetWorthAccountInput } from '../domain/net-worth';
import type { MatchCandidateEntry } from '../domain/csv';

// Dashboard row fetch (spec.md Phase 3) — one scoped query per year, left-joined for
// category direction/name/color and bank account name. Deliberately fetches
// entry-level rows rather than pre-aggregating in SQL: lib/domain/dashboard.ts's pure
// functions do the shaping, which keeps every aggregation unit-testable without a live
// database (spec.md: "aggregation shaping ... as pure functions over row arrays").
export async function getDashboardRows(
  householdId: string,
  year: number,
): Promise<DashboardEntryRow[]> {
  const rows = await db
    .select({
      month: monthlyEntries.month,
      budgetedAmount: monthlyEntries.budgetedAmount,
      actualAmount: monthlyEntries.actualAmount,
      direction: categories.direction,
      categoryId: monthlyEntries.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      recurringScheduleId: monthlyEntries.recurringScheduleId,
      bankAccountId: monthlyEntries.bankAccountId,
      bankAccountName: bankAccounts.name,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .leftJoin(bankAccounts, eq(monthlyEntries.bankAccountId, bankAccounts.id))
    .where(and(eq(monthlyEntries.householdId, householdId), eq(monthlyEntries.year, year)));

  return rows.map((row) => ({
    month: row.month,
    budgetedCents: parseAmountToCents(row.budgetedAmount),
    actualCents: row.actualAmount === null ? null : parseAmountToCents(row.actualAmount),
    direction: row.direction,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryColor: row.categoryColor,
    recurringScheduleId: row.recurringScheduleId,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccountName,
  }));
}

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

// Every entry from every year strictly before `year`, in the minimal shape
// lib/domain/net-worth.ts's sumNetCentsByAccount needs — net worth is a lifetime
// running total, not something that resets when a different year is browsed, so
// whichever year buildAccountBalances walks month-by-month needs everything before it
// folded into a single carry-forward baseline first (see app/(app)/page.tsx). Not
// bounded by month, since the point is "before this year" in full, not any one month.
export async function getAccountEntriesBeforeYear(
  householdId: string,
  year: number,
): Promise<NetWorthPriorEntryRow[]> {
  const rows = await db
    .select({
      bankAccountId: monthlyEntries.bankAccountId,
      direction: categories.direction,
      budgetedAmount: monthlyEntries.budgetedAmount,
      actualAmount: monthlyEntries.actualAmount,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .where(and(eq(monthlyEntries.householdId, householdId), lt(monthlyEntries.year, year)));

  return rows.map((row) => ({
    bankAccountId: row.bankAccountId,
    direction: row.direction,
    amountCents: bestEstimateCents({
      budgetedCents: parseAmountToCents(row.budgetedAmount),
      actualCents: row.actualAmount === null ? null : parseAmountToCents(row.actualAmount),
    }),
  }));
}

export interface CategoryBudgetRow {
  categoryId: string;
  name: string;
  color: string;
  monthlyBudgetCents: number | null;
  spentCents: number;
}

// Current-month spend per expense category with a budget cap (spec.md Phase 4's
// dashboard "budget-health widget") — deliberately scoped to the real current
// month/year, independent of whatever year the dashboard itself is browsing: a
// monthly cap is inherently about "right now," not a historical or future year view.
export async function getCurrentMonthCategoryBudgets(
  householdId: string,
): Promise<CategoryBudgetRow[]> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [categoryRows, entryRows] = await Promise.all([
    db
      .select({
        id: categories.id,
        name: categories.name,
        color: categories.color,
        monthlyBudget: categories.monthlyBudget,
      })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), eq(categories.direction, 'expense'))),
    db
      .select({
        categoryId: monthlyEntries.categoryId,
        budgetedAmount: monthlyEntries.budgetedAmount,
        actualAmount: monthlyEntries.actualAmount,
      })
      .from(monthlyEntries)
      .where(
        and(
          eq(monthlyEntries.householdId, householdId),
          eq(monthlyEntries.year, year),
          eq(monthlyEntries.month, month),
        ),
      ),
  ]);

  const spentByCategory = new Map<string, number>();
  for (const row of entryRows) {
    if (row.categoryId === null) continue;
    const cents = bestEstimateCents({
      budgetedCents: parseAmountToCents(row.budgetedAmount),
      actualCents: row.actualAmount === null ? null : parseAmountToCents(row.actualAmount),
    });
    spentByCategory.set(row.categoryId, (spentByCategory.get(row.categoryId) ?? 0) + cents);
  }

  return categoryRows
    .filter((c) => c.monthlyBudget !== null)
    .map((c) => ({
      categoryId: c.id,
      name: c.name,
      color: c.color,
      monthlyBudgetCents: c.monthlyBudget === null ? null : parseAmountToCents(c.monthlyBudget),
      spentCents: spentByCategory.get(c.id) ?? 0,
    }));
}

export interface ExportRow {
  year: number;
  month: number;
  scheduledDay: number | null;
  item: string;
  categoryName: string | null;
  direction: 'income' | 'expense' | null;
  budgetedAmount: string;
  actualAmount: string | null;
  actualDate: string | null;
  accountName: string | null;
}

// Every entry for the household, across every year (spec.md Phase 5: "export produces
// a correct ... CSV of all entries") — amounts are returned as their original
// numeric(12,2) strings, not parsed to cents and back, since export only ever
// re-serializes them verbatim. `scheduledDay` is reached via recurring_schedule (the
// reference app's export queried a non-existent monthly_entries.scheduled_day column
// directly — see PROGRESS.md's Phase 5 entry); it's null for ad-hoc entries, which
// have no recurring_schedule_id to join through.
export async function getExportRows(householdId: string): Promise<ExportRow[]> {
  const rows = await db
    .select({
      year: monthlyEntries.year,
      month: monthlyEntries.month,
      scheduledDay: recurringSchedule.actualDateDay,
      item: monthlyEntries.item,
      categoryName: categories.name,
      direction: categories.direction,
      budgetedAmount: monthlyEntries.budgetedAmount,
      actualAmount: monthlyEntries.actualAmount,
      actualDate: monthlyEntries.actualDate,
      accountName: bankAccounts.name,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .leftJoin(bankAccounts, eq(monthlyEntries.bankAccountId, bankAccounts.id))
    .leftJoin(recurringSchedule, eq(monthlyEntries.recurringScheduleId, recurringSchedule.id))
    .where(eq(monthlyEntries.householdId, householdId))
    .orderBy(monthlyEntries.year, monthlyEntries.month, monthlyEntries.item);

  return rows;
}

// Candidate entries for lib/domain/csv.ts's classifyRow, scoped to one household +
// year + month — the caller is expected to only ever compare a CSV row's own
// year/month against candidates from that exact month (classifyRow itself does no
// date filtering).
export async function getMatchCandidates(
  householdId: string,
  year: number,
  month: number,
): Promise<MatchCandidateEntry[]> {
  const rows = await db
    .select({
      id: monthlyEntries.id,
      item: monthlyEntries.item,
      direction: categories.direction,
      budgetedAmount: monthlyEntries.budgetedAmount,
      actualAmount: monthlyEntries.actualAmount,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .where(
      and(
        eq(monthlyEntries.householdId, householdId),
        eq(monthlyEntries.year, year),
        eq(monthlyEntries.month, month),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    item: row.item,
    direction: row.direction,
    budgetedCents: parseAmountToCents(row.budgetedAmount),
    actualCents: row.actualAmount === null ? null : parseAmountToCents(row.actualAmount),
  }));
}

export interface NameLookup {
  categoryIdByName: Map<string, string>;
  accountIdByName: Map<string, string>;
}

// Case-insensitive name -> id lookups for resolving a CSV row's free-text
// categoryName/accountName (spec.md: "arbitrary external CSVs") against the
// household's actual categories/accounts. Names aren't unique in the schema, so a
// collision picks whichever row the DB returns first — acceptable for this
// best-effort convenience mapping (worst case, a new ad-hoc entry lands on the
// "wrong" of two identically-named categories; it's never left uncategorized just
// because of a collision, and it's still fully editable afterward).
export async function getNameLookup(householdId: string): Promise<NameLookup> {
  const [categoryRows, accountRows] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.householdId, householdId)),
    db
      .select({ id: bankAccounts.id, name: bankAccounts.name })
      .from(bankAccounts)
      .where(eq(bankAccounts.householdId, householdId)),
  ]);

  const categoryIdByName = new Map<string, string>();
  for (const row of categoryRows) categoryIdByName.set(row.name.trim().toLowerCase(), row.id);
  const accountIdByName = new Map<string, string>();
  for (const row of accountRows) accountIdByName.set(row.name.trim().toLowerCase(), row.id);

  return { categoryIdByName, accountIdByName };
}
