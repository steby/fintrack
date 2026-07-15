// Split from lib/db/queries.ts (batch-4 maintainability pass) — see that file's
// barrel comment. Same household-scoping and money-in-cents conventions throughout.
import { db } from '../index';
import { and, eq } from 'drizzle-orm';
import { monthlyEntries, categories, bankAccounts } from '../schema';
import { parseAmountToCents } from '../../money';
import {
  buildCategoryBudgetRows,
  CategoryBudgetInput,
  CategoryBudgetRow,
  DashboardEntryRow,
} from '../../domain/dashboard';
import { currentYearMonth } from '../../domain/today';

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

// Leaner sibling of getDashboardRows for the dashboard's YoY prior-year baseline,
// which only ever calls lib/domain/dashboard.ts's sumIncomeExpense on the result — that
// function reads just direction/budgetedCents/actualCents, so this selects only those
// (and skips the bankAccounts join getDashboardRows needs for its other consumers
// entirely, since a prior year's category name/color/account are never displayed, only
// summed). Still a plain row-level fetch feeding a pure function, same
// testable-aggregation philosophy as getDashboardRows above — not a parallel SQL SUM
// that could drift from sumIncomeExpense's own logic.
export async function getIncomeExpenseRows(
  householdId: string,
  year: number,
): Promise<Pick<DashboardEntryRow, 'direction' | 'budgetedCents' | 'actualCents'>[]> {
  const rows = await db
    .select({
      budgetedAmount: monthlyEntries.budgetedAmount,
      actualAmount: monthlyEntries.actualAmount,
      direction: categories.direction,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .where(and(eq(monthlyEntries.householdId, householdId), eq(monthlyEntries.year, year)));

  return rows.map((row) => ({
    budgetedCents: parseAmountToCents(row.budgetedAmount),
    actualCents: row.actualAmount === null ? null : parseAmountToCents(row.actualAmount),
    direction: row.direction,
  }));
}

// Leaner sibling of getDashboardRows for the recap cron, which only wants ONE month's
// lib/domain/dashboard.ts's buildMonthlySeries point, not the full year's — fetching
// the whole year just to index into one of the 12 resulting points meant scanning and
// transferring 11 months' worth of rows the recap never uses. buildMonthlySeries only
// reads month/direction/budgetedCents/actualCents, so, like getIncomeExpenseRows
// above, this also skips the bankAccounts join and category name/color columns.
// `categoryId` is included (the leftJoin to `categories` already exists for
// `direction`, so this is a zero-new-join column addition) so app/(app)/page.tsx (Home)
// can also feed these same rows into lib/domain/dashboard.ts's buildCategoryBudgetRows,
// instead of running a second, separate monthly_entries scan of the exact same
// household+year+month partition the way it used to via getCurrentMonthCategoryBudgets.
export async function getDashboardRowsForMonth(
  householdId: string,
  year: number,
  month: number,
): Promise<
  (Pick<
    DashboardEntryRow,
    'month' | 'direction' | 'budgetedCents' | 'actualCents' | 'categoryId'
  > & {
    // True when the entry sits in the reserved Uncategorized category — Home's
    // categorize-nudge counts these (plus legacy null-category rows) without a second
    // scan; the categories join already exists, zero-new-join addition like categoryId.
    categoryIsSystem: boolean;
  })[]
> {
  const rows = await db
    .select({
      month: monthlyEntries.month,
      budgetedAmount: monthlyEntries.budgetedAmount,
      actualAmount: monthlyEntries.actualAmount,
      direction: categories.direction,
      categoryId: monthlyEntries.categoryId,
      categoryIsSystem: categories.isSystem,
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
    month: row.month,
    budgetedCents: parseAmountToCents(row.budgetedAmount),
    actualCents: row.actualAmount === null ? null : parseAmountToCents(row.actualAmount),
    direction: row.direction,
    categoryId: row.categoryId,
    categoryIsSystem: row.categoryIsSystem === true,
  }));
}

// Expense categories with their monthly budget cap, converted to cents (spec.md Phase 4's
// dashboard "budget-health widget") — the categories-only half of the budget-cap fetch,
// factored out so it can be shared by getCurrentMonthCategoryBudgets below (Settings ->
// Categories) and app/(app)/page.tsx (Home), which needs this same category list but
// computes spend from its own already-fetched current-month entries
// (getDashboardRowsForMonth) rather than running a second monthly_entries query. Doesn't
// touch monthly_entries at all, so unlike the entries half there was never a duplicate
// DB round-trip to eliminate here — sharing it is purely a dedup of the query text.
export async function getCurrentMonthExpenseCategories(
  householdId: string,
): Promise<CategoryBudgetInput[]> {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      monthlyBudget: categories.monthlyBudget,
    })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.direction, 'expense')));

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    monthlyBudgetCents: c.monthlyBudget === null ? null : parseAmountToCents(c.monthlyBudget),
  }));
}

// Current-month spend per expense category with a budget cap (spec.md Phase 4's
// dashboard "budget-health widget") — deliberately scoped to the real current
// month/year, independent of whatever year the dashboard itself is browsing: a
// monthly cap is inherently about "right now," not a historical or future year view.
// A thin wrapper over the same two independent sub-queries this always ran (categories
// via getCurrentMonthExpenseCategories, entries via its own monthly_entries query below)
// plus lib/domain/dashboard.ts's buildCategoryBudgetRows for the aggregation — the actual
// per-category spend math used to be inlined here directly; it moved out, unchanged, so
// app/(app)/page.tsx (Home) can run the identical aggregation over rows it already
// fetched instead of via a second call to this function (see getDashboardRowsForMonth's
// doc comment). This function's own output is unaffected by that split: same two
// queries, same math, same result, for its one remaining caller
// (app/(app)/settings/categories/page.tsx).
export async function getCurrentMonthCategoryBudgets(
  householdId: string,
): Promise<CategoryBudgetRow[]> {
  const { year, month } = currentYearMonth();

  const [categoryInputs, entryRows] = await Promise.all([
    getCurrentMonthExpenseCategories(householdId),
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

  return buildCategoryBudgetRows(
    entryRows.map((row) => ({
      categoryId: row.categoryId,
      budgetedCents: parseAmountToCents(row.budgetedAmount),
      actualCents: row.actualAmount === null ? null : parseAmountToCents(row.actualAmount),
    })),
    categoryInputs,
  );
}
