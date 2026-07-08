import { eq, and, sql } from 'drizzle-orm';
import { requireUser } from '../../../lib/auth/guards';
import { can } from '../../../lib/auth/rbac';
import { db } from '../../../lib/db';
import {
  monthlyEntries,
  categories,
  bankAccounts,
  recurringSchedule,
  users,
} from '../../../lib/db/schema';
import { parseYearParam, parseMonthParam, parseViewParam } from '../../../lib/domain/month-params';
import { deriveMonthStatus, type MonthStatus } from '../../../lib/domain/month-status';
import { addMonths } from '../../../lib/domain/recurring';
import { parseAmountToCents } from '../../../lib/money';
import { isEnabled } from '../../../lib/flags';
import { generateEntriesForRange } from '../../../lib/generate-entries';
import { MonthTabs } from './month-tabs';
import { ViewToggle } from './view-toggle';
import { SummaryBar } from './summary-bar';
import { CalendarView } from './calendar-view';
import { ListView } from './list-view';
import { AdhocForm } from './adhoc-form';
import type { MonthlyEntryRow } from './types';

export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const canManage = can(user.role, 'write');
  const params = await searchParams;
  const year = parseYearParam(params.year);
  const month = parseMonthParam(params.month);
  const view = parseViewParam(params.view);

  // On-load hook (spec.md Phase 2): keeps the next 3 months (this one included) always
  // materialized without the household needing to remember to click Generate. Runs on
  // every page load — ON CONFLICT DO NOTHING makes repeated calls cheap no-ops once the
  // window is already filled, an accepted tradeoff at household scale (no formal load
  // tests, per spec.md's Tier-2 scope). Gated by the auto_generate kill-switch so an
  // owner can disable it instantly if it ever misbehaves, without a redeploy. Also
  // gated by `canManage` — viewers are read-only everywhere (lib/auth/rbac.ts), and
  // without this check a viewer's page load would trigger real INSERTs, the one write
  // path in the app that wasn't behind requireRole('write').
  if (canManage && (await isEnabled(user.householdId, 'auto_generate'))) {
    const now = new Date();
    const from = { year: now.getFullYear(), month: now.getMonth() + 1 };
    await generateEntriesForRange(user.householdId, from, addMonths(from, 2));
  }

  const [entries, monthCounts, allCategories, allAccounts, members] = await Promise.all([
    db
      .select({
        id: monthlyEntries.id,
        item: monthlyEntries.item,
        categoryId: monthlyEntries.categoryId,
        budgetedAmount: monthlyEntries.budgetedAmount,
        actualAmount: monthlyEntries.actualAmount,
        actualDate: monthlyEntries.actualDate,
        bankAccountId: monthlyEntries.bankAccountId,
        recurringScheduleId: monthlyEntries.recurringScheduleId,
        isOverridden: monthlyEntries.isOverridden,
        categoryName: categories.name,
        categoryColor: categories.color,
        categoryDirection: categories.direction,
        accountName: bankAccounts.name,
        scheduledDay: recurringSchedule.actualDateDay,
      })
      .from(monthlyEntries)
      .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
      .leftJoin(bankAccounts, eq(monthlyEntries.bankAccountId, bankAccounts.id))
      .leftJoin(recurringSchedule, eq(monthlyEntries.recurringScheduleId, recurringSchedule.id))
      .where(
        and(
          eq(monthlyEntries.householdId, user.householdId),
          eq(monthlyEntries.year, year),
          eq(monthlyEntries.month, month),
        ),
      ),
    db
      .select({
        month: monthlyEntries.month,
        total: sql<number>`count(*)::int`,
        actualized: sql<number>`count(*) filter (where ${monthlyEntries.actualAmount} is not null)::int`,
      })
      .from(monthlyEntries)
      .where(and(eq(monthlyEntries.householdId, user.householdId), eq(monthlyEntries.year, year)))
      .groupBy(monthlyEntries.month),
    db
      .select({ id: categories.id, name: categories.name, direction: categories.direction })
      .from(categories)
      .where(eq(categories.householdId, user.householdId))
      .orderBy(categories.direction, categories.sortOrder),
    db
      .select({ id: bankAccounts.id, name: bankAccounts.name })
      .from(bankAccounts)
      .where(eq(bankAccounts.householdId, user.householdId))
      .orderBy(bankAccounts.sortOrder),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.householdId, user.householdId)),
  ]);

  const typedEntries: MonthlyEntryRow[] = entries;

  const statuses: MonthStatus[] = Array.from({ length: 12 }, (_, i) => {
    const info = monthCounts.find((c) => c.month === i + 1);
    return deriveMonthStatus(info?.total ?? 0, info?.actualized ?? 0);
  });
  const status = statuses[month - 1];

  const incomeEntries = typedEntries.filter((e) => e.categoryDirection === 'income');
  const expenseEntries = typedEntries.filter((e) => e.categoryDirection === 'expense');
  const sumCents = (list: MonthlyEntryRow[], field: 'budgetedAmount' | 'actualAmount') =>
    list.reduce((sum, e) => {
      // `field` is narrowed to the 2-value union in this function's own signature, not
      // external input (same false positive as lib/auth/rbac.ts's MATRIX[role]).
      // eslint-disable-next-line security/detect-object-injection
      const raw = e[field];
      return sum + (raw ? parseAmountToCents(raw) : 0);
    }, 0);

  const statusLabel: Record<MonthStatus, string> = {
    empty: 'No entries — generate a forecast first.',
    forecast: 'Forecast — no actuals entered yet.',
    in_progress: 'In progress — some actuals filled in.',
    closed: 'Closed — all actuals filled in.',
  };

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {monthNames[month - 1]} {year}
          </h1>
          {/* `status` is a MonthStatus union value, not external input (same false
              positive as lib/auth/rbac.ts's MATRIX[role]). */}
          {/* eslint-disable-next-line security/detect-object-injection */}
          <p className="mt-1 text-sm text-muted-foreground">{statusLabel[status]}</p>
        </div>
        {canManage && (
          <AdhocForm
            year={year}
            month={month}
            categories={allCategories}
            accounts={allAccounts}
            members={members}
          />
        )}
      </div>

      <MonthTabs year={year} month={month} view={view} statuses={statuses} />

      {typedEntries.length > 0 && (
        <SummaryBar
          budgetedIncomeCents={sumCents(incomeEntries, 'budgetedAmount')}
          actualIncomeCents={sumCents(incomeEntries, 'actualAmount')}
          budgetedExpenseCents={sumCents(expenseEntries, 'budgetedAmount')}
          actualExpenseCents={sumCents(expenseEntries, 'actualAmount')}
        />
      )}

      {typedEntries.length > 0 && (
        <div className="flex justify-end">
          <ViewToggle year={year} month={month} view={view} />
        </div>
      )}

      {typedEntries.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No entries for this month. Go to the{' '}
          <a href="/recurring" className="underline">
            Recurring schedule
          </a>{' '}
          and generate a forecast.
        </p>
      ) : view === 'list' ? (
        <ListView entries={typedEntries} canManage={canManage} />
      ) : (
        <CalendarView year={year} month={month} entries={typedEntries} agenda={view === 'agenda'} />
      )}
    </div>
  );
}
