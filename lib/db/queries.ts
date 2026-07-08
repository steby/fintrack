import { and, eq } from 'drizzle-orm';
import { db } from './index';
import { monthlyEntries, categories, bankAccounts } from './schema';
import { parseAmountToCents } from '../money';
import type { DashboardEntryRow } from '../domain/dashboard';

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
