export type MonthStatus = 'empty' | 'forecast' | 'in_progress' | 'closed';

// Ported 1:1 from FinanceTracker's monthly/+page.server.ts. `empty` = no entries exist
// yet for this month (nothing generated); `forecast` = entries exist but none actualized;
// `in_progress` = some but not all actualized; `closed` = every entry has an actual.
export function deriveMonthStatus(totalEntries: number, actualizedCount: number): MonthStatus {
  if (totalEntries === 0) return 'empty';
  if (actualizedCount === 0) return 'forecast';
  if (actualizedCount < totalEntries) return 'in_progress';
  return 'closed';
}
