// Split from lib/db/queries.ts (batch-4 maintainability pass) — see that file's
// barrel comment. Same household-scoping and money-in-cents conventions throughout.
import { db } from '../index';
import { and, eq, or } from 'drizzle-orm';
import { monthlyEntries, categories, recurringSchedule } from '../schema';
import type { UpcomingBillCandidate } from '../../domain/reminders';
import type { UpcomingEntryCandidate } from '../../domain/affordability';
import type { YearMonth } from '../../domain/recurring';

// Candidates for lib/domain/reminders.ts's selectUpcomingBills, spanning one or more
// (year, month) buckets — the caller passes both the current month and next month so a
// bill due in the first few days of next month is still visible within the 3-day
// window even though it lives in a different monthly_entries row. OR-of-AND rather than
// a single BETWEEN, since (year, month) pairs don't collapse into one orderable range
// across a year boundary (e.g. Dec 2026 + Jan 2027) without extra arithmetic this avoids.
export async function getUpcomingBillCandidates(
  householdId: string,
  buckets: YearMonth[],
): Promise<UpcomingBillCandidate[]> {
  if (buckets.length === 0) return [];

  const rows = await db
    .select({
      id: monthlyEntries.id,
      item: monthlyEntries.item,
      year: monthlyEntries.year,
      month: monthlyEntries.month,
      actualDateDay: recurringSchedule.actualDateDay,
      actualAmount: monthlyEntries.actualAmount,
      budgetedAmount: monthlyEntries.budgetedAmount,
    })
    .from(monthlyEntries)
    .innerJoin(recurringSchedule, eq(monthlyEntries.recurringScheduleId, recurringSchedule.id))
    .where(
      and(
        eq(monthlyEntries.householdId, householdId),
        or(
          ...buckets.map((b) =>
            and(eq(monthlyEntries.year, b.year), eq(monthlyEntries.month, b.month)),
          ),
        ),
      ),
    );

  return rows;
}

// Candidates for lib/domain/affordability.ts's selectUpcomingItems — Phase 9's superset
// of getUpcomingBillCandidates above, spanning the same kind of (year, month) bucket
// list but LEFT-joining recurring_schedule (not INNER) so ad-hoc entries (no
// recurring_schedule_id at all) are included too, with actualDateDay simply null for
// them — the affordability engine's Home list wants "everything coming up," not just
// fixed-day recurring bills the way the narrower reminder-email selection does. Also
// left-joins categories for direction/name/color, which the email path never needed
// (a plain digest of "these bills are due soon" has no use for a category dot).
// Deliberately a separate query, not a shared helper with getUpcomingBillCandidates —
// spec.md Phase 9: reminders.ts's cron email path must stay byte-identical, and having
// its query share code with a second, actively-evolving consumer is exactly the kind of
// coupling that risks a Phase 10/11 Home change silently altering cron behavior.
export async function getUpcomingEntryCandidates(
  householdId: string,
  buckets: YearMonth[],
): Promise<UpcomingEntryCandidate[]> {
  if (buckets.length === 0) return [];

  const rows = await db
    .select({
      id: monthlyEntries.id,
      item: monthlyEntries.item,
      year: monthlyEntries.year,
      month: monthlyEntries.month,
      actualDateDay: recurringSchedule.actualDateDay,
      actualAmount: monthlyEntries.actualAmount,
      budgetedAmount: monthlyEntries.budgetedAmount,
      direction: categories.direction,
      categoryName: categories.name,
      categoryColor: categories.color,
      // For Home's edit-entry sheet (category preselect + rename gating) — both joins
      // already exist, zero-new-join additions.
      categoryId: monthlyEntries.categoryId,
      recurringScheduleId: monthlyEntries.recurringScheduleId,
    })
    .from(monthlyEntries)
    .leftJoin(recurringSchedule, eq(monthlyEntries.recurringScheduleId, recurringSchedule.id))
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .where(
      and(
        eq(monthlyEntries.householdId, householdId),
        or(
          ...buckets.map((b) =>
            and(eq(monthlyEntries.year, b.year), eq(monthlyEntries.month, b.month)),
          ),
        ),
      ),
    );

  return rows.map(({ recurringScheduleId, ...row }) => ({
    ...row,
    recurringLinked: recurringScheduleId !== null,
  }));
}
