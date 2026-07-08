import { requireUser } from '../../lib/auth/guards';
import { getDashboardRows } from '../../lib/db/queries';
import {
  buildMonthlySeries,
  sumMonthlySeries,
  buildCategoryBreakdown,
  buildCumulativeSavings,
  buildFixedVsVariable,
  buildBankSummary,
  buildYoyDelta,
  sumIncomeExpense,
} from '../../lib/domain/dashboard';
import { parseYearParam } from '../../lib/domain/month-params';
import { StatTiles } from './dashboard/stat-tiles';
import { CashFlowChart } from './dashboard/cash-flow-chart';
import { CategoryChart } from './dashboard/category-chart';
import { SavingsChart } from './dashboard/savings-chart';
import { BankSummaryTable } from './dashboard/bank-summary-table';
import { FixedVariableCard } from './dashboard/fixed-variable-card';
import { YoyCard } from './dashboard/yoy-card';
import { YearPicker } from './dashboard/year-picker';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const year = parseYearParam(params.year);

  const [currentRows, priorRows] = await Promise.all([
    getDashboardRows(user.householdId, year),
    getDashboardRows(user.householdId, year - 1),
  ]);

  const monthlySeries = buildMonthlySeries(currentRows);
  const totals = sumMonthlySeries(monthlySeries);
  const categoryBreakdown = buildCategoryBreakdown(currentRows);
  const cumulativeSavings = buildCumulativeSavings(currentRows);
  const fixedVsVariable = buildFixedVsVariable(currentRows);
  const bankSummary = buildBankSummary(currentRows);
  const yoy = buildYoyDelta(sumIncomeExpense(currentRows), sumIncomeExpense(priorRows));

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BankSummaryTable accounts={bankSummary} />
        </div>
        <FixedVariableCard data={fixedVsVariable} />
      </div>

      <YoyCard yoy={yoy} priorYear={year - 1} />
    </div>
  );
}
