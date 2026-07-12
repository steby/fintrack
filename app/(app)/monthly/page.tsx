import { cookies } from 'next/headers';
import { eq, and, sql } from 'drizzle-orm';
import { CalendarClock } from 'lucide-react';
import { requireUser } from '../../../lib/auth/guards';
import { can } from '../../../lib/auth/rbac';
import { db } from '../../../lib/db';
import {
  monthlyEntries,
  categories,
  bankAccounts,
  recurringSchedule,
} from '../../../lib/db/schema';
import { parseYearParam, parseMonthParam, parseViewParam } from '../../../lib/domain/month-params';
import { deriveMonthStatus, type MonthStatus } from '../../../lib/domain/month-status';
import { addMonths } from '../../../lib/domain/recurring';
import { entryPaidState } from '../../../lib/domain/entries';
import { parseAmountToCents } from '../../../lib/money';
import { isEnabled } from '../../../lib/flags';
import { generateEntriesForRange } from '../../../lib/generate-entries';
import { autoGenerateGuard } from '../../../lib/domain/auto-generate-guard';
import { currentYearMonth, utcStartOfDay } from '../../../lib/domain/today';
import { EmptyState } from '@/components/ui/empty-state';
import { MonthHeader } from './month-header';
import { MonthTabs } from './month-tabs';
import { ViewToggle } from './view-toggle';
import { SummaryBar } from './summary-bar';
import { CalendarView } from './calendar-view';
import { ListView } from './list-view';
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
  // cookies() is async in this Next.js version (v16) — the `fintrack_view` cookie is a
  // client-writable trust boundary exactly like the URL param, so it goes through the
  // SAME parseViewParam allowlist rather than being trusted directly (spec.md Phase 10:
  // "parse and clamp it exactly like URL params"). Read-only here — writing happens
  // client-side from view-toggle.tsx, never during this render (`.set` only works in a
  // Server Action/Route Handler, per this Next.js version's docs).
  const cookieStore = await cookies();
  const view = parseViewParam(params.view, cookieStore.get('fintrack_view')?.value);

  // On-load hook (spec.md Phase 2): keeps the next 3 months (this one included) always
  // materialized without the household needing to remember to click Generate. Guarded
  // by autoGenerateGuard (lib/domain/auto-generate-guard.ts) against re-running the
  // real SELECT + INSERT transaction on every load within a short TTL — switching
  // between visible months/views is a full server render that hits this hook again
  // with the exact same "today"-derived window every time. Also gated by the
  // auto_generate kill-switch so an owner can disable it instantly if it ever
  // misbehaves, without a redeploy, and by `canManage` — viewers are read-only
  // everywhere (lib/auth/rbac.ts), and without this check a viewer's page load would
  // trigger real INSERTs, the one write path in the app that wasn't behind
  // requireRole('write').
  if (
    canManage &&
    autoGenerateGuard.shouldRun(user.householdId) &&
    (await isEnabled(user.householdId, 'auto_generate'))
  ) {
    const from = currentYearMonth();
    await generateEntriesForRange(user.householdId, from, addMonths(from, 2));
    autoGenerateGuard.recordRun(user.householdId);
  }

  const entriesPromise = db
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
    );
  const monthCountsPromise = db
    .select({
      month: monthlyEntries.month,
      total: sql<number>`count(*)::int`,
      actualized: sql<number>`count(*) filter (where ${monthlyEntries.actualAmount} is not null)::int`,
    })
    .from(monthlyEntries)
    .where(and(eq(monthlyEntries.householdId, user.householdId), eq(monthlyEntries.year, year)))
    .groupBy(monthlyEntries.month);

  const [entries, monthCounts] = await Promise.all([entriesPromise, monthCountsPromise]);

  // The ONE paid/overdue/upcoming/unscheduled classification, computed once here and
  // shared by all three views (spec.md Phase 10) — calendar/agenda/list all just read
  // entry.paidState, none of them re-derive "what counts as overdue" themselves, and
  // none of them need a raw `today` Date to cross the server/client boundary.
  const today = utcStartOfDay();
  const typedEntries: MonthlyEntryRow[] = entries.map((entry) => ({
    ...entry,
    paidState: entryPaidState(
      { actualAmount: entry.actualAmount, actualDateDay: entry.scheduledDay, year, month },
      today,
    ),
  }));

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

  const hasEntries = typedEntries.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-1 md:items-start">
        <MonthHeader year={year} month={month} view={view} />
        <p className="text-sm text-muted-foreground">
          {/* eslint-disable-next-line security/detect-object-injection */}
          {statusLabel[status]}
        </p>
      </div>

      <MonthTabs year={year} month={month} view={view} statuses={statuses} />

      {hasEntries && (
        <>
          <SummaryBar
            budgetedIncomeCents={sumCents(incomeEntries, 'budgetedAmount')}
            actualIncomeCents={sumCents(incomeEntries, 'actualAmount')}
            budgetedExpenseCents={sumCents(expenseEntries, 'budgetedAmount')}
            actualExpenseCents={sumCents(expenseEntries, 'actualAmount')}
          />
          <div className="flex justify-end">
            <ViewToggle year={year} month={month} view={view} />
          </div>
        </>
      )}

      {!hasEntries ? (
        <EmptyState
          icon={CalendarClock}
          title="No entries for this month"
          description="Go to Plan and generate a forecast to materialize this month's bills and income."
          action={canManage ? { label: 'Go to Plan', href: '/recurring' } : undefined}
        />
      ) : view === 'list' ? (
        <ListView entries={typedEntries} canManage={canManage} />
      ) : (
        <CalendarView
          year={year}
          month={month}
          entries={typedEntries}
          agenda={view === 'agenda'}
          canManage={canManage}
          today={{
            year: today.getUTCFullYear(),
            month: today.getUTCMonth() + 1,
            day: today.getUTCDate(),
          }}
        />
      )}
    </div>
  );
}
