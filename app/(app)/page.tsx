import { requireUser } from '../../lib/auth/guards';
import { env } from '../../lib/env';
import {
  getDashboardRows,
  getIncomeExpenseRows,
  getAccountsForNetWorth,
  getAccountEntriesBeforeYear,
  getCurrentMonthCategoryBudgets,
} from '../../lib/db/queries';
import {
  buildMonthlySeries,
  sumMonthlySeries,
  buildCategoryBreakdown,
  buildCumulativeSavings,
  buildFixedVsVariable,
  buildBankSummary,
  buildYoyDelta,
  sumIncomeExpense,
  bestEstimateCents,
} from '../../lib/domain/dashboard';
import {
  buildAccountBalances,
  buildNetWorthSeries,
  sumNetCentsByAccount,
} from '../../lib/domain/net-worth';
import { parseYearParam } from '../../lib/domain/month-params';
import { StatTiles } from './dashboard/stat-tiles';
import { CashFlowChart } from './dashboard/cash-flow-chart';
import { CategoryChart } from './dashboard/category-chart';
import { SavingsChart } from './dashboard/savings-chart';
import { BankSummaryTable } from './dashboard/bank-summary-table';
import { FixedVariableCard } from './dashboard/fixed-variable-card';
import { YoyCard } from './dashboard/yoy-card';
import { YearPicker } from './dashboard/year-picker';
import { BudgetHealthCard } from './dashboard/budget-health-card';
import { NetWorthChart } from './dashboard/net-worth-chart';
import { AccountBalancesTable } from './dashboard/account-balances-table';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const year = parseYearParam(params.year);

  const [currentRows, priorIncomeExpenseRows, netWorthAccounts, priorYearsEntries, budgetRows] =
    await Promise.all([
      getDashboardRows(user.householdId, year),
      getIncomeExpenseRows(user.householdId, year - 1),
      env.FEATURE_NET_WORTH ? getAccountsForNetWorth(user.householdId) : Promise.resolve([]),
      env.FEATURE_NET_WORTH
        ? getAccountEntriesBeforeYear(user.householdId, year)
        : Promise.resolve([]),
      env.FEATURE_CATEGORY_BUDGETS
        ? getCurrentMonthCategoryBudgets(user.householdId)
        : Promise.resolve([]),
    ]);

  const monthlySeries = buildMonthlySeries(currentRows);
  const totals = sumMonthlySeries(monthlySeries);
  const categoryBreakdown = buildCategoryBreakdown(currentRows);
  const cumulativeSavings = buildCumulativeSavings(currentRows);
  const fixedVsVariable = buildFixedVsVariable(currentRows);
  const bankSummary = buildBankSummary(currentRows);
  const yoy = buildYoyDelta(
    sumIncomeExpense(currentRows),
    sumIncomeExpense(priorIncomeExpenseRows),
  );

  // Net worth is a lifetime running total, not something that resets every time a
  // different year is browsed — everything from years before `year` is folded into a
  // carry-forward baseline on top of each account's one-time opening_balance, then the
  // selected year's entries walk forward from there month by month.
  let netWorthSeries: ReturnType<typeof buildNetWorthSeries> = [];
  let latestBalances: { accountId: string; name: string; balanceCents: number }[] = [];
  if (env.FEATURE_NET_WORTH) {
    const carryForward = sumNetCentsByAccount(netWorthAccounts, priorYearsEntries);
    const accountBalances = buildAccountBalances(
      netWorthAccounts,
      currentRows.map((row) => ({
        month: row.month,
        bankAccountId: row.bankAccountId,
        direction: row.direction,
        amountCents: bestEstimateCents(row),
      })),
      carryForward,
    );
    netWorthSeries = buildNetWorthSeries(accountBalances);
    latestBalances = netWorthAccounts
      .filter((a) => a.accountType === 'bank')
      .map((a) => ({
        accountId: a.id,
        name: a.name,
        // Every bank account passed in always gets a full 12-point series back, so
        // this is never the empty-array fallback — buildAccountBalances only ever
        // omits an account entirely, never returns it with zero points.
        balanceCents: accountBalances.get(a.id)![11].balanceCents,
      }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
          <p className="text-sm text-muted-foreground">Household overview for {year}</p>
        </div>
        <YearPicker year={year} />
      </div>

      <StatTiles totals={totals} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CashFlowChart series={monthlySeries} />
        <CategoryChart breakdown={categoryBreakdown} />
      </div>

      <SavingsChart series={cumulativeSavings} />

      {env.FEATURE_NET_WORTH && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <NetWorthChart series={netWorthSeries} />
          </div>
          <AccountBalancesTable accounts={latestBalances} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BankSummaryTable accounts={bankSummary} />
        </div>
        <FixedVariableCard data={fixedVsVariable} />
      </div>

      {env.FEATURE_CATEGORY_BUDGETS && <BudgetHealthCard categories={budgetRows} />}

      <YoyCard yoy={yoy} priorYear={year - 1} />
    </div>
  );
}
