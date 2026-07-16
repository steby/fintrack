'use client';

import { Check, AlertTriangle } from 'lucide-react';
import { formatSGDCompact, formatSGD } from '../../../lib/format';
import { parseAmountToCents } from '../../../lib/money';
import { daysInMonth } from '../../../lib/domain/reminders';
import { MarkPaidButton } from '../home/mark-paid-button';
import { EntryEditButton, toEditableEntry } from '../entry-edit-button';
import { useDayBuckets, dailyNetCents } from './use-day-buckets';
import { directionDotClass, paidTextClass } from './entry-style';
import type { MonthlyEntryRow } from './types';

// `today` arrives as plain primitives (year/month/day), not a raw Date — Date objects
// have no established precedent crossing the server/client boundary anywhere else in
// this app, and every entry's paid/overdue/upcoming state is ALREADY computed
// server-side by page.tsx via lib/domain/entries.ts's entryPaidState, so this component
// never needs a Date itself, only "which day number is today, if any."
//
// 'use client' here isn't for any local state or event handler of this component's own
// (there is none — no click-to-open surface, see below) but because useDayBuckets uses
// useMemo internally, which requires a client component boundary.
//
// Split out of a single CalendarView that used to render both the grid and the agenda
// list, switched by a boolean prop — this file is agenda-only now, with no mode
// branching left inside it (see calendar-grid-view.tsx for the grid counterpart,
// including its day-click sheet, which agenda deliberately has no equivalent of).
export function AgendaListView({
  year,
  month,
  entries,
  canManage,
  today,
}: {
  year: number;
  month: number;
  entries: MonthlyEntryRow[];
  canManage: boolean;
  today: { year: number; month: number; day: number };
}) {
  const totalDaysInMonth = daysInMonth(year, month);
  const isCurrentMonth = year === today.year && month === today.month;

  const { byDay, unscheduled, cells } = useDayBuckets(entries, totalDaysInMonth);

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
        <div className="flex flex-col divide-y">
          {cells.map((day) => {
            const dayEntries = byDay.get(day) ?? [];
            // Agenda skips days with nothing due entirely, rather than rendering an
            // empty row for every day of the month like the grid does — a compact list
            // is the whole point of this view.
            if (dayEntries.length === 0) return null;
            const netCents = dailyNetCents(dayEntries);
            const isToday = isCurrentMonth && day === today.day;

            return (
              <div
                key={day}
                data-testid="calendar-cell"
                className={`flex min-h-[100px] flex-col gap-1 bg-background p-2 ${
                  isToday ? 'ring-2 ring-inset ring-primary' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{day}</span>
                  {netCents !== 0 && (
                    <span
                      className={`rounded bg-muted px-1 text-[0.65rem] font-bold ${netCents > 0 ? 'text-income' : 'text-expense'}`}
                    >
                      {netCents > 0 ? '+' : ''}
                      {formatSGDCompact(netCents)}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  {dayEntries.map((entry) => (
                    <AgendaRow key={entry.id} entry={entry} canManage={canManage} />
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
          <div className="flex flex-col gap-2">
            {unscheduled.map((entry) => (
              <AgendaRow key={entry.id} entry={entry} canManage={canManage} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Agenda mode's fuller row — state icon + amount + an inline MarkPaidButton for unpaid
// entries only (spec.md Phase 10: "Agenda — rows get state icon + MarkPaidButton
// inline (unpaid only)"). Reused for both scheduled (inside a day) and unscheduled
// entries — agenda has room for the full row either way, unlike the grid's tiny chip.
function AgendaRow({ entry, canManage }: { entry: MonthlyEntryRow; canManage: boolean }) {
  const state = entry.paidState;
  const amountCents = parseAmountToCents(entry.budgetedAmount);
  return (
    <div
      data-testid="agenda-entry-row"
      data-paid-state={state}
      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        {state === 'paid' ? (
          <Check className="size-4 shrink-0 text-income" aria-label="Paid" />
        ) : state === 'overdue' ? (
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-label="Overdue" />
        ) : (
          <span
            className={`size-2 shrink-0 rounded-full ${directionDotClass(entry.categoryDirection)}`}
            aria-hidden
          />
        )}
        <div className="min-w-0">
          <div className={`truncate text-sm font-medium ${paidTextClass(state)}`}>{entry.item}</div>
          {entry.categoryName && (
            <div className="truncate text-xs text-muted-foreground">{entry.categoryName}</div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={
            entry.categoryDirection === 'income'
              ? 'text-sm font-medium text-income tabular-nums'
              : 'text-sm tabular-nums'
          }
        >
          {entry.categoryDirection === 'income' ? '+' : ''}
          {formatSGD(amountCents)}
        </span>
        {canManage && state !== 'paid' && (
          <MarkPaidButton
            entryId={entry.id}
            item={entry.item}
            amountCents={amountCents}
            direction={entry.categoryDirection}
            size="xs"
            variant="ghost"
          />
        )}
        {canManage && (
          <EntryEditButton entry={toEditableEntry(entry)} className="text-muted-foreground" />
        )}
      </div>
    </div>
  );
}
