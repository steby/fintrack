import type { PaidState } from '../../../lib/domain/entries';

export interface MonthlyEntryRow {
  id: string;
  item: string;
  categoryId: string | null;
  budgetedAmount: string;
  actualAmount: string | null;
  actualDate: string | null;
  bankAccountId: string | null;
  recurringScheduleId: string | null;
  isOverridden: boolean;
  categoryName: string | null;
  categoryColor: string | null;
  categoryDirection: 'income' | 'expense' | null;
  accountName: string | null;
  scheduledDay: number | null;
  // FX-assist annotation (display-only; all three set together or all null).
  originalAmount: string | null;
  originalCurrency: string | null;
  fxRate: string | null;
  // Phase 10: computed once, server-side, by page.tsx via lib/domain/entries.ts's
  // entryPaidState — the ONE classifier all three views (calendar, agenda, list) share,
  // so calendar/agenda/entry-row never need their own copy of "what does overdue mean"
  // or a raw `today` Date crossing the server/client boundary just to recompute it.
  paidState: PaidState;
}
