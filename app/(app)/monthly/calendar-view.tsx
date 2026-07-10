import { formatSGDCompact } from '../../../lib/format';
import { parseAmountToCents } from '../../../lib/money';
import { daysInMonth } from '../../../lib/domain/reminders';
import { currentYearMonth } from '../../../lib/domain/today';
import type { MonthlyEntryRow } from './types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarView({
  year,
  month,
  entries,
  agenda,
}: {
  year: number;
  month: number;
  entries: MonthlyEntryRow[];
  agenda: boolean;
}) {
  const totalDaysInMonth = daysInMonth(year, month);
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const today = new Date();
  const current = currentYearMonth(today);
  const isCurrentMonth = year === current.year && month === current.month;

  const byDay = new Map<number, MonthlyEntryRow[]>();
  const unscheduled: MonthlyEntryRow[] = [];
  for (const entry of entries) {
    if (entry.scheduledDay) {
      // Clamp to the last real day of the month (spec.md's Phase 6 email-reminder logic
      // already establishes "month-end clamping for day 29-31" as the intended handling
      // for a scheduled day that doesn't exist in a shorter month) — without this, an
      // entry with scheduledDay=31 silently vanished from Feb/30-day months entirely,
      // since cells only spans 1..totalDaysInMonth and a truthy scheduledDay never
      // falls through to the "unscheduled" bucket either.
      const day = Math.min(entry.scheduledDay, totalDaysInMonth);
      const list = byDay.get(day) ?? [];
      list.push(entry);
      byDay.set(day, list);
    } else {
      unscheduled.push(entry);
    }
  }

  const cells = Array.from({ length: totalDaysInMonth }, (_, i) => i + 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-md border">
        <div
          className={
            agenda ? 'flex flex-col divide-y' : 'grid min-w-[800px] grid-cols-7 gap-px bg-border'
          }
        >
          {!agenda &&
            DAY_NAMES.map((d) => (
              <div
                key={d}
                className="bg-muted/40 p-2 text-center text-xs font-semibold text-muted-foreground uppercase"
              >
                {d}
              </div>
            ))}
          {!agenda &&
            Array.from({ length: firstDayOfWeek }, (_, i) => (
              <div key={`empty-${i}`} className="min-h-[100px] bg-muted/10" />
            ))}
          {cells.map((day) => {
            const dayEntries = byDay.get(day) ?? [];
            if (agenda && dayEntries.length === 0) return null;
            // Uncategorized entries (categoryDirection null) are excluded from the net,
            // not treated as expenses — consistent with summary-bar.tsx/page.tsx's
            // sumCents, which excludes them from both income and expense totals for the
            // same reason: a direction-less amount can't be classified as either.
            const dailyNetCents = dayEntries.reduce((sum, e) => {
              if (e.categoryDirection === null) return sum;
              const cents = parseAmountToCents(e.budgetedAmount);
              return sum + (e.categoryDirection === 'income' ? cents : -cents);
            }, 0);
            const isToday = isCurrentMonth && day === today.getUTCDate();

            return (
              <div
                key={day}
                data-testid="calendar-cell"
                className={`flex min-h-[100px] flex-col gap-1 bg-background p-2 ${isToday ? 'ring-2 ring-inset ring-primary' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{day}</span>
                  {dailyNetCents !== 0 && (
                    <span
                      className={`rounded bg-muted px-1 text-[0.65rem] font-bold ${dailyNetCents > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                    >
                      {dailyNetCents > 0 ? '+' : ''}
                      {formatSGDCompact(dailyNetCents)}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  {dayEntries.map((entry) => (
                    <div
                      key={entry.id}
                      title={entry.item}
                      className="flex items-center justify-between gap-1 text-[0.65rem]"
                    >
                      <span className="flex items-center gap-1 truncate">
                        <span
                          className={`size-1.5 shrink-0 rounded-full ${
                            entry.categoryDirection === 'income'
                              ? 'bg-emerald-500'
                              : entry.categoryDirection === 'expense'
                                ? 'bg-red-500'
                                : 'bg-muted-foreground'
                          }`}
                          aria-hidden
                        />
                        <span className="truncate">{entry.item}</span>
                      </span>
                      <span className="shrink-0 font-semibold text-muted-foreground">
                        {formatSGDCompact(parseAmountToCents(entry.budgetedAmount))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            No scheduled day
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {unscheduled.map((entry) => (
              <div
                key={entry.id}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                  entry.categoryDirection === 'income'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : entry.categoryDirection === 'expense'
                      ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                <span className="truncate font-medium">{entry.item}</span>
                <span className="shrink-0 font-semibold">
                  {formatSGDCompact(parseAmountToCents(entry.budgetedAmount))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
