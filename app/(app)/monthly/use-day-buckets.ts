'use client';

import { useMemo } from 'react';
import type { MonthlyEntryRow } from './types';

// Shared by CalendarGridView and AgendaListView (split out of the single CalendarView
// this repo used to have) — both views need the exact same "which entries fall on
// which day of the month, and which have no scheduled day at all" bucketing, and
// duplicating this walk in two files would risk the two copies drifting apart.
//
// Memoized on its actual inputs (entries, totalDaysInMonth) rather than recomputed on
// every render — a caller's own unrelated local UI state (e.g. CalendarGridView's
// `openDay` state, opened/closed as its day-sheet is used) changes far more often than
// `entries` ever does, and none of that local UI state should force a re-walk of every
// entry into fresh Map/array allocations.
export function useDayBuckets(entries: MonthlyEntryRow[], totalDaysInMonth: number) {
  return useMemo(() => {
    const byDay = new Map<number, MonthlyEntryRow[]>();
    const unscheduled: MonthlyEntryRow[] = [];
    for (const entry of entries) {
      if (entry.scheduledDay) {
        // Clamp to the last real day of the month (spec.md's Phase 6 email-reminder
        // logic already establishes "month-end clamping for day 29-31" as the intended
        // handling for a scheduled day that doesn't exist in a shorter month) — without
        // this, an entry with scheduledDay=31 silently vanished from Feb/30-day months
        // entirely, since cells only spans 1..totalDaysInMonth and a truthy
        // scheduledDay never falls through to the "unscheduled" bucket either.
        const day = Math.min(entry.scheduledDay, totalDaysInMonth);
        const list = byDay.get(day) ?? [];
        list.push(entry);
        byDay.set(day, list);
      } else {
        unscheduled.push(entry);
      }
    }
    const cells = Array.from({ length: totalDaysInMonth }, (_, i) => i + 1);
    return { byDay, unscheduled, cells };
  }, [entries, totalDaysInMonth]);
}
