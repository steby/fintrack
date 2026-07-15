// Split from lib/db/queries.ts (batch-4 maintainability pass) — see that file's
// barrel comment. Same household-scoping and money-in-cents conventions throughout.
import { db } from '../index';
import { and, eq } from 'drizzle-orm';
import { monthlyEntries, categories, bankAccounts, recurringSchedule } from '../schema';
import { parseAmountToCents } from '../../money';
import type { MatchCandidateEntry } from '../../domain/csv';
import { warnIfUnusuallyLarge } from './shared';

export interface ExportRow {
  year: number;
  month: number;
  scheduledDay: number | null;
  item: string;
  categoryName: string | null;
  direction: 'income' | 'expense' | null;
  budgetedAmount: string;
  actualAmount: string | null;
  actualDate: string | null;
  accountName: string | null;
}

// Every entry for the household, across every year (spec.md Phase 5: "export produces
// a correct ... CSV of all entries") — amounts are returned as their original
// numeric(12,2) strings, not parsed to cents and back, since export only ever
// re-serializes them verbatim. `scheduledDay` is reached via recurring_schedule (the
// reference app's export queried a non-existent monthly_entries.scheduled_day column
// directly — see PROGRESS.md's Phase 5 entry); it's null for ad-hoc entries, which
// have no recurring_schedule_id to join through.
export async function getExportRows(householdId: string): Promise<ExportRow[]> {
  const rows = await db
    .select({
      year: monthlyEntries.year,
      month: monthlyEntries.month,
      scheduledDay: recurringSchedule.actualDateDay,
      item: monthlyEntries.item,
      categoryName: categories.name,
      direction: categories.direction,
      budgetedAmount: monthlyEntries.budgetedAmount,
      actualAmount: monthlyEntries.actualAmount,
      actualDate: monthlyEntries.actualDate,
      accountName: bankAccounts.name,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .leftJoin(bankAccounts, eq(monthlyEntries.bankAccountId, bankAccounts.id))
    .leftJoin(recurringSchedule, eq(monthlyEntries.recurringScheduleId, recurringSchedule.id))
    .where(eq(monthlyEntries.householdId, householdId))
    .orderBy(monthlyEntries.year, monthlyEntries.month, monthlyEntries.item);

  warnIfUnusuallyLarge('getExportRows', householdId, rows.length);

  return rows;
}

// Candidate entries for lib/domain/csv.ts's classifyRow, scoped to one household +
// year + month — the caller is expected to only ever compare a CSV row's own
// year/month against candidates from that exact month (classifyRow itself does no
// date filtering).
export async function getMatchCandidates(
  householdId: string,
  year: number,
  month: number,
): Promise<MatchCandidateEntry[]> {
  const rows = await db
    .select({
      id: monthlyEntries.id,
      item: monthlyEntries.item,
      direction: categories.direction,
      budgetedAmount: monthlyEntries.budgetedAmount,
      actualAmount: monthlyEntries.actualAmount,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .where(
      and(
        eq(monthlyEntries.householdId, householdId),
        eq(monthlyEntries.year, year),
        eq(monthlyEntries.month, month),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    item: row.item,
    direction: row.direction,
    budgetedCents: parseAmountToCents(row.budgetedAmount),
    actualCents: row.actualAmount === null ? null : parseAmountToCents(row.actualAmount),
  }));
}

export interface NameLookup {
  categoryIdByName: Map<string, string>;
  accountIdByName: Map<string, string>;
}

// Case-insensitive name -> id lookups for resolving a CSV row's free-text
// categoryName/accountName (spec.md: "arbitrary external CSVs") against the
// household's actual categories/accounts. Names aren't unique in the schema, so a
// collision picks whichever row the DB returns first — acceptable for this
// best-effort convenience mapping (worst case, a new ad-hoc entry lands on the
// "wrong" of two identically-named categories; it's never left uncategorized just
// because of a collision, and it's still fully editable afterward).
export async function getNameLookup(householdId: string): Promise<NameLookup> {
  const [categoryRows, accountRows] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.householdId, householdId)),
    db
      .select({ id: bankAccounts.id, name: bankAccounts.name })
      .from(bankAccounts)
      .where(eq(bankAccounts.householdId, householdId)),
  ]);

  const categoryIdByName = new Map<string, string>();
  for (const row of categoryRows) categoryIdByName.set(row.name.trim().toLowerCase(), row.id);
  const accountIdByName = new Map<string, string>();
  for (const row of accountRows) accountIdByName.set(row.name.trim().toLowerCase(), row.id);

  return { categoryIdByName, accountIdByName };
}
