import { eq, and } from 'drizzle-orm';
import { db } from './db';
import { recurringSchedule, monthlyEntries } from './db/schema';
import { shouldGenerate, walkMonths, type YearMonth } from './domain/recurring';

// Shared by app/actions/recurring.ts's generateAction (user-triggered, an explicit
// date range) and the Monthly page's auto-generate-on-load hook (a fixed rolling
// window) — both need exactly "materialize monthly_entries for every active recurring
// item across this month range," so the walk + bulk-insert logic lives here once
// rather than being duplicated at each call site. Not a Server Action itself (no
// 'use server' in this file) — it's an internal helper, not a client-callable RPC.
export async function generateEntriesForRange(
  householdId: string,
  from: YearMonth,
  to: YearMonth,
): Promise<number> {
  const months = walkMonths(from, to);
  if (months.length === 0) return 0;

  // spec.md: "Generate: INSERT … ON CONFLICT DO NOTHING in one transaction." The SELECT
  // of active items and the bulk INSERT are wrapped together so a recurring item edited,
  // toggled inactive, or deleted between the two (plausible: the auto-generate hook runs
  // on every /monthly page load, potentially concurrently with a household member editing
  // that same item on /recurring) can't produce entries generated from a stale read —
  // Postgres's REPEATABLE READ-or-stronger guarantee isn't needed here since the SELECT
  // and INSERT are otherwise independent statements; the transaction's real job is
  // ensuring the two either both apply or the caller sees a clean failure, not a
  // half-applied generate.
  return db.transaction(async (tx) => {
    const activeItems = await tx
      .select()
      .from(recurringSchedule)
      .where(
        and(eq(recurringSchedule.householdId, householdId), eq(recurringSchedule.isActive, true)),
      );

    const rowsToInsert = months.flatMap(({ year, month }) =>
      activeItems
        .filter((item) => shouldGenerate(item.frequency, item.scheduleMonths, month))
        .map((item) => ({
          householdId,
          year,
          month,
          recurringScheduleId: item.id,
          item: item.item,
          categoryId: item.categoryId,
          budgetedAmount: item.budgetedAmount,
          bankAccountId: item.bankAccountId,
        })),
    );

    if (rowsToInsert.length === 0) return 0;

    // ON CONFLICT DO NOTHING against the existing unique index on
    // (household_id, year, month, recurring_schedule_id) — idempotent: a repeat call
    // over an overlapping range only inserts genuinely new months. `.returning()`
    // reports the true new-row count, not rowsToInsert.length.
    const inserted = await tx
      .insert(monthlyEntries)
      .values(rowsToInsert)
      .onConflictDoNothing()
      .returning({ id: monthlyEntries.id });

    return inserted.length;
  });
}
