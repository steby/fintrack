import { requireUser } from '../../../lib/auth/guards';
import { getDashboardRows, getIncomeExpenseRows } from '../../../lib/db/queries';
import {
  buildMonthlySeries,
  sumMonthlySeries,
  buildCategoryBreakdown,
  buildCumulativeSavings,
  buildFixedVsVariable,
  buildYoyDelta,
  sumIncomeExpense,
} from '../../../lib/domain/dashboard';
import { parseYearParam } from '../../../lib/domain/month-params';
import { StatTiles } from '../dashboard/stat-tiles';
import { CashFlowChart } from '../dashboard/cash-flow-chart';
import { CategoryChart } from '../dashboard/category-chart';
import { SavingsChart } from '../dashboard/savings-chart';
import { FixedVariableCard } from '../dashboard/fixed-variable-card';
import { YoyCard } from '../dashboard/yoy-card';
import { YearPicker } from '../dashboard/year-picker';

// Year analytics — the pre-redesign dashboard's widgets on their own route (moved here
// in Phase 8; this page has been their ONLY home since Phase 9 replaced that dashboard
// with the forecast-first Home — an earlier comment here described the transitional
// duplication as still pending; review finding).
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const year = parseYearParam(params.year);

  const [currentRows, priorIncomeExpenseRows] = await Promise.all([
    getDashboardRows(user.householdId, year),
    getIncomeExpenseRows(user.householdId, year - 1),
  ]);

  const monthlySeries = buildMonthlySeries(currentRows);
  const totals = sumMonthlySeries(monthlySeries);
  const categoryBreakdown = buildCategoryBreakdown(currentRows);
  const cumulativeSavings = buildCumulativeSavings(currentRows);
  const fixedVsVariable = buildFixedVsVariable(currentRows);
  const yoy = buildYoyDelta(
    sumIncomeExpense(currentRows),
    sumIncomeExpense(priorIncomeExpenseRows),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Insights</h1>
          <p className="text-sm text-muted-foreground">Year analytics for {year}</p>
        </div>
        <YearPicker year={year} basePath="/insights" />
      </div>

      <StatTiles totals={totals} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CashFlowChart series={monthlySeries} />
        <CategoryChart breakdown={categoryBreakdown} />
      </div>

      <SavingsChart series={cumulativeSavings} />

      <FixedVariableCard data={fixedVsVariable} />

      <YoyCard yoy={yoy} priorYear={year - 1} />
    </div>
  );
}
