'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, AlertTriangle } from 'lucide-react';
import { formatSGDCompact, formatSGD, MONTH_FULL } from '../../../lib/format';
import { parseAmountToCents } from '../../../lib/money';
import { daysInMonth } from '../../../lib/domain/reminders';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { MarkPaidButton } from '../home/mark-paid-button';
import type { MonthlyEntryRow } from './types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Phase 10: client component (it wasn't before) so a day cell can open a per-day
// ResponsiveSheet — the local `openDay` state is what requires it. `today` arrives as
// plain primitives (year/month/day), not a raw Date — Date objects have no established
// precedent crossing the server/client boundary anywhere else in this app, and every
// entry's paid/overdue/upcoming state is ALREADY computed server-side by page.tsx via
// lib/domain/entries.ts's entryPaidState, so this component never needs a Date itself,
// only "which day number is today, if any."
export function CalendarView({
  year,
  month,
  entries,
  agenda,
  canManage,
  today,
}: {
  year: number;
  month: number;
  entries: MonthlyEntryRow[];
  agenda: boolean;
  canManage: boolean;
  today: { year: number; month: number; day: number };
}) {
  const [openDay, setOpenDay] = useState<number | null>(null);
  const totalDaysInMonth = daysInMonth(year, month);
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const isCurrentMonth = year === today.year && month === today.month;

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
  const openDayEntries = openDay !== null ? (byDay.get(openDay) ?? []) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
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
            const isToday = isCurrentMonth && day === today.day;
            // Day-cell-click-opens-a-sheet is grid-only (spec.md Phase 10 task 4) —
            // agenda rows already show full entries with an inline MarkPaidButton each,
            // so a second click surface on the same row would be redundant.
            const clickable = canManage && !agenda && dayEntries.length > 0;

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
                  {dayEntries.map((entry) =>
                    agenda ? (
                      <AgendaRow key={entry.id} entry={entry} canManage={canManage} />
                    ) : (
                      <GridChip key={entry.id} entry={entry} />
                    ),
                  )}
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
          <div
            className={
              agenda
                ? 'flex flex-col gap-2'
                : 'grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4'
            }
          >
            {unscheduled.map((entry) =>
              agenda ? (
                <AgendaRow key={entry.id} entry={entry} canManage={canManage} />
              ) : (
                <UnscheduledChip key={entry.id} entry={entry} />
              ),
            )}
          </div>
        </div>
      )}

      {/* Mounted whenever a day sheet COULD open (grid mode, canManage) rather than
          only while one is — Base UI's Dialog/Drawer render nothing visible while
          `open` is false, and keeping it mounted means revalidatePath('/monthly') after
          a mark-paid inside it re-renders THIS component with fresh `entries`, and
          because `openDay` is untouched by that re-render, the sheet stays open with
          updated rows instead of flashing closed (spec.md Phase 10 edge case: "mark-paid
          from calendar day sheet revalidates without closing weirdness"). */}
      {canManage && !agenda && (
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
          className={`size-1.5 shrink-0 rounded-full ${
            entry.categoryDirection === 'income'
              ? 'bg-income'
              : entry.categoryDirection === 'expense'
                ? 'bg-expense'
                : 'bg-muted-foreground'
          }`}
          aria-hidden
        />
        <span className={`truncate ${state === 'overdue' ? 'font-semibold text-warning' : ''}`}>
          {state === 'paid' && '✓ '}
          {entry.item}
        </span>
      </span>
      <span className="shrink-0 font-semibold text-muted-foreground">
        {formatSGDCompact(parseAmountToCents(entry.budgetedAmount))}
      </span>
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
            className={`size-2 shrink-0 rounded-full ${
              entry.categoryDirection === 'income'
                ? 'bg-income'
                : entry.categoryDirection === 'expense'
                  ? 'bg-expense'
                  : 'bg-muted-foreground'
            }`}
            aria-hidden
          />
        )}
        <div className="min-w-0">
          <div
            className={`truncate text-sm font-medium ${
              state === 'paid'
                ? 'text-muted-foreground line-through decoration-muted-foreground/50'
                : ''
            }`}
          >
            {entry.item}
          </div>
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
            size="xs"
            variant="ghost"
          />
        )}
      </div>
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
        {state === 'paid' && '✓ '}
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
        <div
          className={`truncate text-sm font-medium ${
            state === 'paid'
              ? 'text-muted-foreground line-through decoration-muted-foreground/50'
              : ''
          }`}
        >
          {entry.item}
        </div>
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
