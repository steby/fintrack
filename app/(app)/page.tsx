import { CalendarClock } from 'lucide-react';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { requireUser } from '../../lib/auth/guards';
import { can } from '../../lib/auth/rbac';
import { env } from '../../lib/env';
import { db } from '../../lib/db';
import { goals as goalsTable } from '../../lib/db/schema';
import {
  getAccountsForNetWorth,
  getActualizedCashRows,
  getUpcomingEntryCandidates,
  getDashboardRowsForMonth,
  getCurrentMonthCategoryBudgets,
} from '../../lib/db/queries';
import { getSetting } from '../../lib/settings';
import { sumNetCentsByAccount } from '../../lib/domain/net-worth';
import { addMonths } from '../../lib/domain/recurring';
import { currentYearMonth, utcStartOfDay } from '../../lib/domain/today';
import { parseYearParam } from '../../lib/domain/month-params';
import {
  parseHorizon,
  resolveHorizonDays,
  selectUpcomingItems,
  computeSafeToSpend,
  computeBudgetRemaining,
  buildRunway,
} from '../../lib/domain/affordability';
import { EmptyState } from '@/components/ui/empty-state';
import { SafeToSpendHero } from './home/safe-to-spend-hero';
import { UpcomingList } from './home/upcoming-list';
import { RunwaySparkline } from './home/runway-sparkline';
import { BudgetMini } from './home/budget-mini';
import { GoalsMini } from './home/goals-mini';

// Forecast-first Home (spec.md Phase 9) — replaces the pre-redesign dashboard (its
// widgets now live permanently on /insights and /accounts, moved there in Phase 8).
// Answers "can I cover what's coming": a cash lens (primary, when trustworthy) and a
// budget-remaining lens (secondary, always shown; promoted to primary when the cash
// lens isn't trustworthy) — see safe-to-spend-hero.tsx for the exact promotion rule.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();

  // post-redesign bug-fix pass: Home ignored `?year=` entirely, so a stale
  // `/?year=2023`-style bookmark (from before Phase 8 moved year-scoped widgets off
  // this page) silently rendered "now" with no indication the requested year was
  // dropped. A lightweight courtesy redirect instead: a present, valid, and DIFFERENT
  // year sends the visitor to the page that's actually year-scoped now (/insights)
  // rather than pretending the bookmark still means "today." Absent or already-current
  // year renders Home normally — no behavior change for the common case.
  const params = await searchParams;
  const requestedYear = parseYearParam(params.year);
  if (params.year !== undefined && requestedYear !== currentYearMonth().year) {
    redirect(`/insights?year=${requestedYear}`);
  }

  const canManage = can(user.role, 'write');
  const today = utcStartOfDay();
  const current = currentYearMonth(today);
  const nextMonth = addMonths(current, 1);

  const [
    rawHorizon,
    candidates,
    netWorthAccounts,
    actualizedRows,
    currentMonthRows,
    budgetRows,
    topGoals,
  ] = await Promise.all([
    getSetting(user.householdId, 'affordability_horizon'),
    getUpcomingEntryCandidates(user.householdId, [current, nextMonth]),
    env.FEATURE_NET_WORTH ? getAccountsForNetWorth(user.householdId) : Promise.resolve([]),
    env.FEATURE_NET_WORTH ? getActualizedCashRows(user.householdId) : Promise.resolve([]),
    getDashboardRowsForMonth(user.householdId, current.year, current.month),
    env.FEATURE_CATEGORY_BUDGETS
      ? getCurrentMonthCategoryBudgets(user.householdId)
      : Promise.resolve([]),
    env.FEATURE_SAVINGS_GOALS
      ? db
          .select()
          .from(goalsTable)
          .where(eq(goalsTable.householdId, user.householdId))
          .orderBy(goalsTable.createdAt)
          .limit(3)
      : Promise.resolve([]),
  ]);

  // A brand-new household with nothing recorded yet has nothing to forecast against —
  // showing a $0 hero and an empty list would look broken, not reassuring. Guide them to
  // set up recurring items instead (spec.md Phase 9 edge case).
  if (candidates.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
        <EmptyState
          icon={CalendarClock}
          title="Nothing on the books yet"
          description="Set up recurring bills and income so Home can show what's coming up and whether you can cover it."
          action={canManage ? { label: 'Set up your plan', href: '/recurring' } : undefined}
        />
      </div>
    );
  }

  const horizon = parseHorizon(rawHorizon);
  const horizonDays = resolveHorizonDays(horizon, today);
  const items = selectUpcomingItems(candidates, today, horizonDays);
  const throughDate = new Date(today.getTime() + horizonDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const expenseItemCount = items.filter((i) => i.direction === 'expense').length;

  // Cash lens is only trustworthy when net worth tracking is on AND there's at least one
  // bank account to sum — spec.md: "FEATURE_NET_WORTH off or zero bank accounts ->
  // promote the budget lens to hero, hide the cash lens entirely."
  const bankAccountsList = netWorthAccounts.filter((a) => a.accountType === 'bank');
  const cashLensActive = env.FEATURE_NET_WORTH && bankAccountsList.length > 0;

  // sumNetCentsByAccount/currentCashCents only ever feed safeToSpend/runwayPoints below,
  // both already gated behind cashLensActive — skip the walk over netWorthAccounts/
  // actualizedRows entirely when the cash lens is off (FEATURE_NET_WORTH disabled or
  // zero bank accounts), instead of computing a value nothing reads.
  let safeToSpend: ReturnType<typeof computeSafeToSpend> | null = null;
  let runwayPoints: ReturnType<typeof buildRunway> = [];
  if (cashLensActive) {
    const netByAccount = sumNetCentsByAccount(netWorthAccounts, actualizedRows);
    const currentCashCents = bankAccountsList.reduce(
      (sum, a) => sum + a.openingBalanceCents + (netByAccount.get(a.id) ?? 0),
      0,
    );
    safeToSpend = computeSafeToSpend(currentCashCents, items);
    runwayPoints = buildRunway(currentCashCents, items, today, horizonDays);
  }
  const budgetRemaining = computeBudgetRemaining(currentMonthRows);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
        <p className="text-sm text-muted-foreground">Household forecast</p>
      </div>

      <SafeToSpendHero
        cashLensActive={cashLensActive}
        safeToSpend={safeToSpend}
        budgetRemaining={budgetRemaining}
        expenseItemCount={expenseItemCount}
        throughDate={throughDate}
        horizon={horizon}
        canManage={canManage}
      />

      {cashLensActive && <RunwaySparkline points={runwayPoints} />}

      <UpcomingList items={items} canManage={canManage} />

      {(env.FEATURE_CATEGORY_BUDGETS || env.FEATURE_SAVINGS_GOALS) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {env.FEATURE_CATEGORY_BUDGETS && <BudgetMini categories={budgetRows} />}
          {env.FEATURE_SAVINGS_GOALS && <GoalsMini goals={topGoals} />}
        </div>
      )}
    </div>
  );
}
