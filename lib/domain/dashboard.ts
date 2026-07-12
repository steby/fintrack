// Aggregation shaping for the dashboard (spec.md Phase 3) — pure functions over row
// arrays already fetched from the DB (lib/db/queries.ts does the fetching; these
// functions do the math), so every edge case (empty year, all-zero, partial actuals,
// missing prior year) is unit-testable without a live database.

export interface DashboardEntryRow {
  month: number; // 1-12
  budgetedCents: number;
  actualCents: number | null;
  // null = uncategorized — excluded from every sum here, same convention established in
  // Phase 2's summary-bar.tsx and the monthly calendar/agenda views (a direction-less
  // amount can't be classified as either income or expense).
  direction: 'income' | 'expense' | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  // null = ad-hoc/variable entry (no recurring template behind it).
  recurringScheduleId: string | null;
  bankAccountId: string | null;
  bankAccountName: string | null;
}

// "Best available estimate" for a single entry — an actualized entry's real amount,
// falling back to what was budgeted for anything still just a forecast. Mirrors the
// reference app's `COALESCE(actual_amount, budgeted_amount)` pattern, used everywhere
// here except the monthly series (which shows budgeted and actual side by side, not
// coalesced, since that comparison is the whole point of that widget).
export function bestEstimateCents(
  row: Pick<DashboardEntryRow, 'budgetedCents' | 'actualCents'>,
): number {
  return row.actualCents ?? row.budgetedCents;
}

// The Phase 9 affordability engine's "how much cash is actually in the bank right now"
// figure needs the OPPOSITE fallback rule from bestEstimateCents above: an unpaid bill
// hasn't left the account yet, so it must contribute nothing to a cash total (not its
// budgeted amount) — the affordability hero already represents that unpaid bill as a
// separate subtraction term (lib/domain/affordability.ts's upcomingExpenseCents/
// overdueExpenseCents), so folding it into "cash" too would subtract it twice. Exists as
// its own named function, not an inline `row.actualCents` at the call site, purely so a
// reader immediately sees WHY actuals-only is correct here — the same one-line-of-logic,
// document-the-intent role bestEstimateCents already plays for its own call sites.
export function actualOnlyCents(row: Pick<DashboardEntryRow, 'actualCents'>): number | null {
  return row.actualCents;
}

export interface MonthlyPoint {
  month: number;
  budgetedIncomeCents: number;
  actualIncomeCents: number;
  budgetedExpenseCents: number;
  actualExpenseCents: number;
  netBudgetedCents: number;
  netActualCents: number;
  hasActuals: boolean;
}

// Always returns exactly 12 points (Jan-Dec), even for a year with zero rows — so chart
// components never have to special-case a short/missing series. Parameter type is
// narrowed to the 4 fields actually read (not the full DashboardEntryRow) — the recap
// cron only wants a single month's point out of the 12 returned, so it can pass a
// query result scoped to just that month (lib/db/queries.ts's
// getDashboardRowsForMonth) rather than fetching every month in the year to discard 11
// of the resulting 12 points. A full DashboardEntryRow[] (page.tsx's usage) is still
// assignable here — Pick<> only narrows what this function is allowed to read, not
// what a caller may pass.
export function buildMonthlySeries(
  rows: Pick<DashboardEntryRow, 'month' | 'direction' | 'budgetedCents' | 'actualCents'>[],
): MonthlyPoint[] {
  type Row = (typeof rows)[number];
  const byMonth = new Map<number, Row[]>();
  for (const row of rows) {
    const list = byMonth.get(row.month) ?? [];
    list.push(row);
    byMonth.set(row.month, list);
  }

  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const entries = byMonth.get(month) ?? [];

    let budgetedIncomeCents = 0;
    let actualIncomeCents = 0;
    let budgetedExpenseCents = 0;
    let actualExpenseCents = 0;
    let hasActuals = false;

    for (const entry of entries) {
      if (entry.actualCents !== null) hasActuals = true;
      if (entry.direction === 'income') {
        budgetedIncomeCents += entry.budgetedCents;
        actualIncomeCents += entry.actualCents ?? 0;
      } else if (entry.direction === 'expense') {
        budgetedExpenseCents += entry.budgetedCents;
        actualExpenseCents += entry.actualCents ?? 0;
      }
    }

    return {
      month,
      budgetedIncomeCents,
      actualIncomeCents,
      budgetedExpenseCents,
      actualExpenseCents,
      netBudgetedCents: budgetedIncomeCents - budgetedExpenseCents,
      netActualCents: actualIncomeCents - actualExpenseCents,
      hasActuals,
    };
  });
}

export interface YearTotals {
  budgetedIncomeCents: number;
  actualIncomeCents: number;
  budgetedExpenseCents: number;
  actualExpenseCents: number;
  netBudgetedCents: number;
  netActualCents: number;
}

export function sumMonthlySeries(series: MonthlyPoint[]): YearTotals {
  const totals = series.reduce(
    (acc, m) => ({
      budgetedIncomeCents: acc.budgetedIncomeCents + m.budgetedIncomeCents,
      actualIncomeCents: acc.actualIncomeCents + m.actualIncomeCents,
      budgetedExpenseCents: acc.budgetedExpenseCents + m.budgetedExpenseCents,
      actualExpenseCents: acc.actualExpenseCents + m.actualExpenseCents,
    }),
    {
      budgetedIncomeCents: 0,
      actualIncomeCents: 0,
      budgetedExpenseCents: 0,
      actualExpenseCents: 0,
    },
  );
  return {
    ...totals,
    netBudgetedCents: totals.budgetedIncomeCents - totals.budgetedExpenseCents,
    netActualCents: totals.actualIncomeCents - totals.actualExpenseCents,
  };
}

export interface CategoryBreakdownPoint {
  categoryId: string;
  name: string;
  color: string;
  totalBudgetedCents: number;
  totalActualCents: number;
  actualizedCount: number;
  totalCount: number;
}

// Expense categories only (matches the reference app's dashboard category chart, which
// is expense-focused) — sorted by budgeted amount descending, largest slice first.
export function buildCategoryBreakdown(rows: DashboardEntryRow[]): CategoryBreakdownPoint[] {
  const byCategory = new Map<string, CategoryBreakdownPoint>();
  for (const row of rows) {
    if (row.direction !== 'expense' || row.categoryId === null) continue;
    const existing = byCategory.get(row.categoryId);
    const point = existing ?? {
      categoryId: row.categoryId,
      name: row.categoryName ?? 'Uncategorized',
      color: row.categoryColor ?? '#6B7280',
      totalBudgetedCents: 0,
      totalActualCents: 0,
      actualizedCount: 0,
      totalCount: 0,
    };
    point.totalBudgetedCents += row.budgetedCents;
    point.totalActualCents += row.actualCents ?? 0;
    point.totalCount += 1;
    if (row.actualCents !== null) point.actualizedCount += 1;
    byCategory.set(row.categoryId, point);
  }
  return Array.from(byCategory.values()).sort(
    (a, b) => b.totalBudgetedCents - a.totalBudgetedCents,
  );
}

export interface CumulativePoint {
  month: number;
  cumulativeNetCents: number;
}

// Running "best estimate" net (income minus expense, per entry coalesced to actual when
// available) across the year — a savings trend line, not a strict budgeted/actual split.
export function buildCumulativeSavings(rows: DashboardEntryRow[]): CumulativePoint[] {
  const netByMonth = new Map<number, number>();
  for (const row of rows) {
    if (row.direction === null) continue;
    const signed = row.direction === 'income' ? bestEstimateCents(row) : -bestEstimateCents(row);
    netByMonth.set(row.month, (netByMonth.get(row.month) ?? 0) + signed);
  }

  let running = 0;
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    running += netByMonth.get(month) ?? 0;
    return { month, cumulativeNetCents: running };
  });
}

export interface FixedVsVariable {
  fixedExpenseCents: number;
  variableExpenseCents: number;
}

// "Fixed" = generated from a recurring template; "variable" = ad-hoc. Matches the
// reference app's `recurring_schedule_id IS NOT NULL` split exactly (ported from
// FinanceTracker/src/routes/+page.server.ts).
export function buildFixedVsVariable(rows: DashboardEntryRow[]): FixedVsVariable {
  let fixedExpenseCents = 0;
  let variableExpenseCents = 0;
  for (const row of rows) {
    if (row.direction !== 'expense') continue;
    if (row.recurringScheduleId !== null) {
      fixedExpenseCents += bestEstimateCents(row);
    } else {
      variableExpenseCents += bestEstimateCents(row);
    }
  }
  return { fixedExpenseCents, variableExpenseCents };
}

export interface BankSummaryPoint {
  bankAccountId: string;
  name: string;
  totalInflowCents: number;
  totalOutflowCents: number;
}

export function buildBankSummary(rows: DashboardEntryRow[]): BankSummaryPoint[] {
  const byAccount = new Map<string, BankSummaryPoint>();
  for (const row of rows) {
    if (row.bankAccountId === null) continue;
    const existing = byAccount.get(row.bankAccountId);
    const point = existing ?? {
      bankAccountId: row.bankAccountId,
      name: row.bankAccountName ?? 'Unknown account',
      totalInflowCents: 0,
      totalOutflowCents: 0,
    };
    if (row.direction === 'income') {
      point.totalInflowCents += bestEstimateCents(row);
    } else if (row.direction === 'expense') {
      point.totalOutflowCents += bestEstimateCents(row);
    }
    byAccount.set(row.bankAccountId, point);
  }
  return Array.from(byAccount.values());
}

// Household-wide income/expense totals for a set of rows, "best estimate" per entry —
// used for the prior year's YoY baseline, where only the totals matter, not a
// month-by-month or budgeted/actual breakdown. Mirrors the reference app's
// prevYearTotals query semantics exactly (`COALESCE(actual_amount, budgeted_amount)`).
// Parameter type is narrowed to just the 3 fields actually read (not the full
// DashboardEntryRow) — lets the YoY caller fetch a leaner row shape (no category
// name/color, no bank account join) for the prior year, which this function alone
// consumes, without a parallel/duplicated SQL SUM that could drift from this logic.
export function sumIncomeExpense(
  rows: Pick<DashboardEntryRow, 'direction' | 'budgetedCents' | 'actualCents'>[],
): {
  incomeCents: number;
  expenseCents: number;
} {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const row of rows) {
    if (row.direction === 'income') incomeCents += bestEstimateCents(row);
    else if (row.direction === 'expense') expenseCents += bestEstimateCents(row);
  }
  return { incomeCents, expenseCents };
}

export interface YoyDelta {
  incomeCents: number;
  incomeDeltaCents: number;
  incomePercent: number | null;
  expenseCents: number;
  expenseDeltaCents: number;
  expensePercent: number | null;
}

// null percent (rather than Infinity/NaN) means "no prior-year baseline to compare
// against" — the UI hides the percentage in that case instead of showing garbage.
function percentDelta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

export function buildYoyDelta(
  current: { incomeCents: number; expenseCents: number },
  prior: { incomeCents: number; expenseCents: number },
): YoyDelta {
  return {
    incomeCents: current.incomeCents,
    incomeDeltaCents: current.incomeCents - prior.incomeCents,
    incomePercent: percentDelta(current.incomeCents, prior.incomeCents),
    expenseCents: current.expenseCents,
    expenseDeltaCents: current.expenseCents - prior.expenseCents,
    expensePercent: percentDelta(current.expenseCents, prior.expenseCents),
  };
}

export interface CategoryBudgetInput {
  id: string;
  name: string;
  color: string;
  monthlyBudgetCents: number | null;
}

export interface CategoryBudgetRow {
  categoryId: string;
  name: string;
  color: string;
  monthlyBudgetCents: number | null;
  spentCents: number;
}

// Per-category current-month spend against a budget cap (spec.md Phase 4's dashboard
// "budget-health widget"). Lives here, not lib/db/queries.ts, so it's a pure function
// testable without a live database — moved out of what used to be logic inlined
// directly inside lib/db/queries.ts's getCurrentMonthCategoryBudgets, so that query and
// app/(app)/page.tsx (Home) can share one implementation instead of each doing its own
// entries scan of monthly_entries for the same household+current-month partition. Both
// parameters are already in cents (never raw numeric(12,2) strings) — same
// convert-in-the-query-layer, compute-in-cents convention every other function in this
// file follows. Categories with no monthly cap set (monthlyBudgetCents === null) are
// excluded from the result entirely — this widget only ever shows categories the
// household has actually capped.
export function buildCategoryBudgetRows(
  entries: { categoryId: string | null; budgetedCents: number; actualCents: number | null }[],
  categories: CategoryBudgetInput[],
): CategoryBudgetRow[] {
  const spentByCategory = new Map<string, number>();
  for (const row of entries) {
    if (row.categoryId === null) continue;
    const cents = bestEstimateCents({
      budgetedCents: row.budgetedCents,
      actualCents: row.actualCents,
    });
    spentByCategory.set(row.categoryId, (spentByCategory.get(row.categoryId) ?? 0) + cents);
  }

  return categories
    .filter((c) => c.monthlyBudgetCents !== null)
    .map((c) => ({
      categoryId: c.id,
      name: c.name,
      color: c.color,
      monthlyBudgetCents: c.monthlyBudgetCents,
      spentCents: spentByCategory.get(c.id) ?? 0,
    }));
}
