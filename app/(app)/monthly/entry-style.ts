import type { MonthlyEntryRow } from './types';
import type { PaidState } from '../../../lib/domain/entries';

// Shared row-renderer styling helpers (maintainability pass) — GridChip, AgendaRow,
// UnscheduledChip, and DaySheetRow (now split across calendar-grid-view.tsx and
// agenda-list-view.tsx) each used to hand-roll their own copy of these two small
// conditionals. Pulled out once, used everywhere, purely a style-string extraction: no
// row renderer's actual output changed.
export function directionDotClass(direction: MonthlyEntryRow['categoryDirection']): string {
  return direction === 'income'
    ? 'bg-income'
    : direction === 'expense'
      ? 'bg-expense'
      : 'bg-muted-foreground';
}

export function paidTextClass(state: PaidState): string {
  return state === 'paid'
    ? 'text-muted-foreground line-through decoration-muted-foreground/50'
    : '';
}

export function paidPrefix(state: PaidState): string {
  return state === 'paid' ? '✓ ' : '';
}
