'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatSGDCompact, formatSGD, MONTH_FULL } from '../../../lib/format';
import { parseAmountToCents } from '../../../lib/money';
import { daysInMonth } from '../../../lib/domain/reminders';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { MarkPaidButton } from '../home/mark-paid-button';
import { useDayBuckets } from './use-day-buckets';
import { directionDotClass, paidTextClass, paidPrefix } from './entry-style';
import type { MonthlyEntryRow } from './types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Phase 10: client component (it wasn't before) so a day cell can open a per-day
// ResponsiveSheet — the local `openDay` state is what requires it. `today` arrives as
// plain primitives (year/month/day), not a raw Date — Date objects have no established
// precedent crossing the server/client boundary anywhere else in this app, and every
// entry's paid/overdue/upcoming state is ALREADY computed server-side by page.tsx via
// lib/domain/entries.ts's entryPaidState, so this component never needs a Date itself,
// only "which day number is today, if any."
//
// Split out of a single CalendarView that used to render both the grid and the agenda
// list, switched by a boolean prop — this file is grid-only now, with no mode
// branching left inside it (see agenda-list-view.tsx for the agenda counterpart).
export function CalendarGridView({
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
  const [openDay, setOpenDay] = useState<number | null>(null);
  const totalDaysInMonth = daysInMonth(year, month);
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const isCurrentMonth = year === today.year && month === today.month;

  const { byDay, unscheduled, cells } = useDayBuckets(entries, totalDaysInMonth);

  const openDayEntries = openDay !== null ? (byDay.get(openDay) ?? []) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
        <div className="grid min-w-[800px] grid-cols-7 gap-px bg-border">
          {DAY_NAMES.map((d) => (
            <div
              key={d}
              className="bg-muted/40 p-2 text-center text-xs font-semibold text-muted-foreground uppercase"
            >
              {d}
            </div>
          ))}
          {Array.from({ length: firstDayOfWeek }, (_, i) => (
            <div key={`empty-${i}`} className="min-h-[100px] bg-muted/10" />
          ))}
          {cells.map((day) => {
            const dayEntries = byDay.get(day) ?? [];
            // Uncategorized entries (categoryDirection null) are excluded from the net,
            // not treated as expenses — consistent with summary-bar.tsx/page.tsx's
            // sumCents, which excludes them from both income and expense totals for the
            // same reason: a direction-less amount can't be classified as either.
            const dailyNetCents = dayEntries.reduce((sum, e) => {
              if (e.categoryDirection === null) return sum;
              const cents = parseAmountToCents(e.budgetedAmount);
              return sum + (e.categoryDirection === 'income' ? cents : -cents);
            }, 0);
            const isToday = isCurrentMonth && day === today.day;
            // Day-cell-click-opens-a-sheet is grid-only (spec.md Phase 10 task 4) —
            // agenda rows already show full entries with an inline MarkPaidButton each,
            // so a second click surface on the same row would be redundant there (see
            // agenda-list-view.tsx, which has no click handling at all).
            const clickable = canManage && dayEntries.length > 0;

            return (
              <div
                key={day}
                data-testid="calendar-cell"
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-label={clickable ? `${MONTH_FULL[month - 1]} ${day} entries` : undefined}
                onClick={clickable ? () => setOpenDay(day) : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setOpenDay(day);
                        }
                      }
                    : undefined
                }
                className={`flex min-h-[100px] flex-col gap-1 bg-background p-2 ${
                  isToday ? 'ring-2 ring-inset ring-primary' : ''
                } ${clickable ? 'cursor-pointer hover:bg-muted/30' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{day}</span>
                  {dailyNetCents !== 0 && (
                    <span
                      className={`rounded bg-muted px-1 text-[0.65rem] font-bold ${dailyNetCents > 0 ? 'text-income' : 'text-expense'}`}
                    >
                      {dailyNetCents > 0 ? '+' : ''}
                      {formatSGDCompact(dailyNetCents)}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  {dayEntries.map((entry) => (
                    <GridChip key={entry.id} entry={entry} />
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
              <UnscheduledChip key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}

      {/* Mounted whenever a day sheet COULD open (canManage) rather than only while one
          is — Base UI's Dialog/Drawer render nothing visible while `open` is false, and
          keeping it mounted means revalidatePath('/monthly') after a mark-paid inside it
          re-renders THIS component with fresh `entries`, and because `openDay` is
          untouched by that re-render, the sheet stays open with updated rows instead of
          flashing closed (spec.md Phase 10 edge case: "mark-paid from calendar day sheet
          revalidates without closing weirdness"). */}
      {canManage && (
        <ResponsiveSheet
          open={openDay !== null}
          onOpenChange={(open) => {
            if (!open) setOpenDay(null);
          }}
          title={openDay !== null ? `${MONTH_FULL[month - 1]} ${openDay}, ${year}` : ''}
          description="Entries due this day"
        >
          <div className="flex flex-col gap-2">
            {openDayEntries.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nothing due this day.
              </p>
            )}
            {openDayEntries.map((entry) => (
              <DaySheetRow key={entry.id} entry={entry} canManage={canManage} />
            ))}
            <Link
              href={`/monthly?year=${year}&month=${month}&view=list`}
              className="pt-1 text-center text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              View in list
            </Link>
          </div>
        </ResponsiveSheet>
      )}
    </div>
  );
}

// Compact grid-cell chip (Phase 10 paid-state styling — spec.md: "paid = muted + ✓
// prefix; overdue = text-warning ring; upcoming = category-color dot as today").
function GridChip({ entry }: { entry: MonthlyEntryRow }) {
  const state = entry.paidState;
  return (
    <div
      title={entry.item}
      data-testid="calendar-entry-chip"
      data-paid-state={state}
      className={`flex items-center justify-between gap-1 rounded px-0.5 text-[0.65rem] ${
        state === 'paid' ? 'opacity-50' : state === 'overdue' ? 'ring-1 ring-warning/70' : ''
      }`}
    >
      <span className="flex items-center gap-1 truncate">
        <span
          className={`size-1.5 shrink-0 rounded-full ${directionDotClass(entry.categoryDirection)}`}
          aria-hidden
        />
        <span className={`truncate ${state === 'overdue' ? 'font-semibold text-warning' : ''}`}>
          {paidPrefix(state)}
          {entry.item}
        </span>
      </span>
      <span className="shrink-0 font-semibold text-muted-foreground">
        {formatSGDCompact(parseAmountToCents(entry.budgetedAmount))}
      </span>
    </div>
  );
}

// Grid mode's "no scheduled day" section — same paid-muted/✓-prefix treatment as
// GridChip, at a more readable size since these entries get their own dedicated
// section below the day grid rather than fighting for space inside a 100px cell.
function UnscheduledChip({ entry }: { entry: MonthlyEntryRow }) {
  const state = entry.paidState;
  const toneClass =
    entry.categoryDirection === 'income'
      ? 'bg-income/10 text-income'
      : entry.categoryDirection === 'expense'
        ? 'bg-expense/10 text-expense'
        : 'bg-muted text-muted-foreground';
  return (
    <div
      data-testid="calendar-entry-chip"
      data-paid-state={state}
      className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${toneClass} ${
        state === 'paid' ? 'opacity-50' : ''
      }`}
    >
      <span className="truncate font-medium">
        {paidPrefix(state)}
        {entry.item}
      </span>
      <span className="shrink-0 font-semibold">
        {formatSGDCompact(parseAmountToCents(entry.budgetedAmount))}
      </span>
    </div>
  );
}

// One row inside the day-click ResponsiveSheet — a plainer list-item layout than
// AgendaRow (no category dot needed; the sheet is already scoped to a single day).
function DaySheetRow({ entry, canManage }: { entry: MonthlyEntryRow; canManage: boolean }) {
  const state = entry.paidState;
  const budgetedCents = parseAmountToCents(entry.budgetedAmount);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-2">
      <div className="min-w-0">
        <div className={`truncate text-sm font-medium ${paidTextClass(state)}`}>{entry.item}</div>
        <div className="text-xs text-muted-foreground">
          {formatSGD(budgetedCents)}
          {state === 'overdue' && <span className="ml-1.5 font-medium text-warning">Overdue</span>}
        </div>
      </div>
      {canManage && state !== 'paid' ? (
        <MarkPaidButton
          entryId={entry.id}
          item={entry.item}
          amountCents={budgetedCents}
          size="sm"
          variant="outline"
        />
      ) : state === 'paid' ? (
        <span className="shrink-0 text-xs text-muted-foreground">Paid</span>
      ) : null}
    </div>
  );
}
