// Split from lib/db/queries.ts (batch-4 maintainability pass) — see that file's
// barrel comment. Same household-scoping and money-in-cents conventions throughout.
import { db } from '../index';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { monthlyEntries, categories } from '../schema';

// Idempotency claim for Phase 6's cron emails (spec.md: "cron double-fire must not
// double-send"). Inserts a ledger row via ON CONFLICT DO NOTHING and reports whether
// *this* call actually created it — the atomic part a SELECT-then-INSERT can't
// guarantee under two overlapping cron invocations. Callers claim right BEFORE the
// send loop, after confirming there's actually something to send (bills/content AND
// opted-in recipients) — not any earlier. Claiming before those checks would let a
// household with nothing to send *yet* (e.g. zero recipients today) permanently
// forfeit the period even if that changes before a genuine double-fire, since the slot
// would already show as claimed. A slot claimed here that then fails to send (Resend
// down) is not retried until the next scheduled period, matching spec.md's documented
// failure mode ("retry w/ backoff, then log + degrade") rather than adding a second,
// unbounded retry loop across cron runs.
export const TRANSACTION_SEARCH_LIMIT = 100;

export interface TransactionSearchRow {
  id: string;
  item: string;
  year: number;
  month: number;
  budgetedAmount: string;
  actualAmount: string | null;
  actualDate: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  direction: 'income' | 'expense' | null;
}

// Cross-month transaction search (/transactions — full app review finding #5: Money is
// strictly month-scoped, so "when did I last pay the dentist?" meant clicking through
// months one at a time). Text match is a case-insensitive substring on the item name
// with LIKE metacharacters escaped — a search for "100%" must match the literal text,
// not turn into a wildcard (and `\` itself must be escaped first, or a trailing
// backslash in the query corrupts the pattern). Newest first (year, month, then dated
// actuals before undated forecasts within a month), LIMIT-bounded — this is a search
// surface, not an export; api/export remains the complete-data path.
export async function searchTransactions(
  householdId: string,
  filters: { q?: string; categoryId?: string },
): Promise<TransactionSearchRow[]> {
  const conditions = [eq(monthlyEntries.householdId, householdId)];
  if (filters.q) {
    const escaped = filters.q.replace(/\\/g, '\\\\').replace(/[%_]/g, (m) => `\\${m}`);
    conditions.push(ilike(monthlyEntries.item, `%${escaped}%`));
  }
  if (filters.categoryId) {
    conditions.push(eq(monthlyEntries.categoryId, filters.categoryId));
  }

  return db
    .select({
      id: monthlyEntries.id,
      item: monthlyEntries.item,
      year: monthlyEntries.year,
      month: monthlyEntries.month,
      budgetedAmount: monthlyEntries.budgetedAmount,
      actualAmount: monthlyEntries.actualAmount,
      actualDate: monthlyEntries.actualDate,
      categoryId: monthlyEntries.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      direction: categories.direction,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(
      desc(monthlyEntries.year),
      desc(monthlyEntries.month),
      sql`${monthlyEntries.actualDate} DESC NULLS LAST`,
      monthlyEntries.item,
    )
    .limit(TRANSACTION_SEARCH_LIMIT);
}
