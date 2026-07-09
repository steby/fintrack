// See lib/db/queries.ts's getAccountEntriesBeforeYear/getExportRows for why this is a
// warning threshold, not a truncating LIMIT — a pure predicate so the exact cutoff
// behavior is unit-testable without seeding tens of thousands of real rows.
export const UNBOUNDED_QUERY_ROW_WARNING_THRESHOLD = 20_000;

export function isUnusuallyLargeRowCount(rowCount: number): boolean {
  return rowCount > UNBOUNDED_QUERY_ROW_WARNING_THRESHOLD;
}
