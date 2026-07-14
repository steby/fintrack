import { and, eq, isNotNull, lt, or, sql } from 'drizzle-orm';
import { db } from './index';
import { logger } from '../log';
import { isUnusuallyLargeRowCount } from '../domain/query-limits';
import {
  monthlyEntries,
  categories,
  bankAccounts,
  recurringSchedule,
  households,
  users,
  emailLog,
} from './schema';
import { parseAmountToCents } from '../money';
import {
  buildCategoryBudgetRows,
  type CategoryBudgetInput,
  type CategoryBudgetRow,
  type DashboardEntryRow,
} from '../domain/dashboard';
import type { NetWorthAccountInput } from '../domain/net-worth';
import type { MatchCandidateEntry } from '../domain/csv';
import type { UpcomingBillCandidate } from '../domain/reminders';
import type { UpcomingEntryCandidate } from '../domain/affordability';
import type { YearMonth } from '../domain/recurring';
import { currentYearMonth } from '../domain/today';

// Re-exported so existing importers (app/(app)/home/budget-mini.tsx,
// app/(app)/dashboard/budget-health-card.tsx) can keep importing it from this file's
// public surface unchanged — the type itself now lives in lib/domain/dashboard.ts
// alongside the buildCategoryBudgetRows pure function that produces it, matching this
// file's existing pattern of domain modules owning row/result types (DashboardEntryRow,
// NetWorthAccountInput, MatchCandidateEntry, etc.) that queries.ts imports rather than
// defines itself.
export type { CategoryBudgetRow };

// Matches lib/flags.ts's KillSwitchKey pattern: a small, hand-written union rather than
// derived from the pgEnum, since Drizzle doesn't export a ready-made TS type for enum
// columns and this is only ever used at these two call sites.
export type EmailType = 'reminder' | 'recap';

// Shared by app/actions/recurring.ts and app/actions/monthly.ts — both need "does this
// optional foreign-key id refer to a real row IN THIS HOUSEHOLD" before accepting it
// (category/account/paid-by-user references on a recurring item or a monthly entry;
// spec.md threat note: missing household_id filter -> cross-tenant leak). Was two
// verbatim copies before this extraction; no `error` string on the failure branch —
// every call site at both action files discards it and substitutes its own
// field-specific message ('Category not found.', 'Bank account not found.', etc.), so
// carrying a generic one here was dead weight inviting someone to "fix" a message that
// never reaches a user.
export async function resolveOptionalRef(
  table: typeof categories | typeof bankAccounts | typeof users,
  householdId: string,
  raw: string | undefined,
): Promise<{ ok: true; value: string | null } | { ok: false }> {
  if (!raw) return { ok: true, value: null };
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, raw), eq(table.householdId, householdId)))
    .limit(1);
  if (!row) {
    return { ok: false };
  }
  return { ok: true, value: raw };
}

// The reserved per-household "Uncategorized" expense category (schema.ts: isSystem).
// Self-healing: normally created by migration 0004/seed, but any household that somehow
// lacks one gets it created on first use — the partial unique index
// (categories_household_system_unique) turns a concurrent double-create race into a
// harmless conflict, so insert-then-reselect is safe.
export async function getOrCreateUncategorizedCategoryId(householdId: string): Promise<string> {
  const systemCategory = () =>
    db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), eq(categories.isSystem, true)))
      .limit(1);

  const [existing] = await systemCategory();
  if (existing) return existing.id;

  await db
    .insert(categories)
    .values({
      householdId,
      name: 'Uncategorized',
      direction: 'expense',
      color: '#6B7280',
      sortOrder: 999,
      isSystem: true,
    })
    .onConflictDoNothing();
  const [created] = await systemCategory();
  if (!created) {
    // Unreachable: either our insert landed or a concurrent one did — reselecting must
    // find a row. Loud beats a silently uncategorized entry.
    throw new Error(`No system Uncategorized category for household ${householdId}`);
  }
  return created.id;
}

export interface EntryFormOptions {
  categories: { id: string; name: string; direction: 'income' | 'expense'; isSystem: boolean }[];
  accounts: { id: string; name: string }[];
  members: { id: string; name: string }[];
}

// Powers both the Monthly page's list-view category filter context and, as of Phase 10,
// the GLOBAL quick-add sheet mounted in app/(app)/layout.tsx — extracted from what used
// to be three inline queries duplicated only inside app/(app)/monthly/page.tsx, since
// quick-add now needs the exact same three option lists on EVERY page, not just
// /monthly. Same ordering (category direction then sortOrder; account sortOrder) the
// old inline version used, so the select dropdowns' item order doesn't change for
// existing users.
export async function getEntryFormOptions(householdId: string): Promise<EntryFormOptions> {
  const [categoryRows, accountRows, memberRows] = await Promise.all([
    db
      .select({
        id: categories.id,
        name: categories.name,
        direction: categories.direction,
        isSystem: categories.isSystem,
      })
      .from(categories)
      .where(eq(categories.householdId, householdId))
      .orderBy(categories.direction, categories.sortOrder),
    db
      .select({ id: bankAccounts.id, name: bankAccounts.name })
      .from(bankAccounts)
      .where(eq(bankAccounts.householdId, householdId))
      .orderBy(bankAccounts.sortOrder),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.householdId, householdId)),
  ]);

  return { categories: categoryRows, accounts: accountRows, members: memberRows };
}

// Warning (not truncating) ceiling for the two "every entry ever" queries below
// (getAccountEntriesBeforeYear, getExportRows) — spec.md Phase 7 calls for "pagination
// caps on list queries", but both of these are correctness-critical: one feeds a
// lifetime running balance, the other IS the full export. Silently truncating past a
// LIMIT would produce a wrong net-worth total or an incomplete export — worse than the
// unbounded-growth problem a cap is meant to solve. The connection pool's own
// statement_timeout (lib/db/index.ts) is the real hard backstop against pathological
// growth; this just logs loudly long before that ever fires (see
// lib/domain/query-limits.ts for the threshold and why it's a pure, unit-tested
// predicate rather than inlined here). This helper stays here rather than in
// lib/domain/query-limits.ts — that module is deliberately pure/side-effect-free (no
// other lib/domain/*.ts file imports the logger), and a warn call would break that.
function warnIfUnusuallyLarge(queryName: string, householdId: string, rowCount: number) {
  if (isUnusuallyLargeRowCount(rowCount)) {
    logger.warn({ householdId, rowCount }, `${queryName} returned an unusually large row count`);
  }
}

// Dashboard row fetch (spec.md Phase 3) — one scoped query per year, left-joined for
// category direction/name/color and bank account name. Deliberately fetches
// entry-level rows rather than pre-aggregating in SQL: lib/domain/dashboard.ts's pure
// functions do the shaping, which keeps every aggregation unit-testable without a live
// database (spec.md: "aggregation shaping ... as pure functions over row arrays").
export async function getDashboardRows(
  householdId: string,
  year: number,
): Promise<DashboardEntryRow[]> {
  const rows = await db
    .select({
      month: monthlyEntries.month,
      budgetedAmount: monthlyEntries.budgetedAmount,
      actualAmount: monthlyEntries.actualAmount,
      direction: categories.direction,
      categoryId: monthlyEntries.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      recurringScheduleId: monthlyEntries.recurringScheduleId,
      bankAccountId: monthlyEntries.bankAccountId,
      bankAccountName: bankAccounts.name,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .leftJoin(bankAccounts, eq(monthlyEntries.bankAccountId, bankAccounts.id))
    .where(and(eq(monthlyEntries.householdId, householdId), eq(monthlyEntries.year, year)));

  return rows.map((row) => ({
    month: row.month,
    budgetedCents: parseAmountToCents(row.budgetedAmount),
    actualCents: row.actualAmount === null ? null : parseAmountToCents(row.actualAmount),
    direction: row.direction,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryColor: row.categoryColor,
    recurringScheduleId: row.recurringScheduleId,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccountName,
  }));
}

// Leaner sibling of getDashboardRows for the dashboard's YoY prior-year baseline,
// which only ever calls lib/domain/dashboard.ts's sumIncomeExpense on the result — that
// function reads just direction/budgetedCents/actualCents, so this selects only those
// (and skips the bankAccounts join getDashboardRows needs for its other consumers
// entirely, since a prior year's category name/color/account are never displayed, only
// summed). Still a plain row-level fetch feeding a pure function, same
// testable-aggregation philosophy as getDashboardRows above — not a parallel SQL SUM
// that could drift from sumIncomeExpense's own logic.
export async function getIncomeExpenseRows(
  householdId: string,
  year: number,
): Promise<Pick<DashboardEntryRow, 'direction' | 'budgetedCents' | 'actualCents'>[]> {
  const rows = await db
    .select({
      budgetedAmount: monthlyEntries.budgetedAmount,
      actualAmount: monthlyEntries.actualAmount,
      direction: categories.direction,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .where(and(eq(monthlyEntries.householdId, householdId), eq(monthlyEntries.year, year)));

  return rows.map((row) => ({
    budgetedCents: parseAmountToCents(row.budgetedAmount),
    actualCents: row.actualAmount === null ? null : parseAmountToCents(row.actualAmount),
    direction: row.direction,
  }));
}

// Leaner sibling of getDashboardRows for the recap cron, which only wants ONE month's
// lib/domain/dashboard.ts's buildMonthlySeries point, not the full year's — fetching
// the whole year just to index into one of the 12 resulting points meant scanning and
// transferring 11 months' worth of rows the recap never uses. buildMonthlySeries only
// reads month/direction/budgetedCents/actualCents, so, like getIncomeExpenseRows
// above, this also skips the bankAccounts join and category name/color columns.
// `categoryId` is included (the leftJoin to `categories` already exists for
// `direction`, so this is a zero-new-join column addition) so app/(app)/page.tsx (Home)
// can also feed these same rows into lib/domain/dashboard.ts's buildCategoryBudgetRows,
// instead of running a second, separate monthly_entries scan of the exact same
// household+year+month partition the way it used to via getCurrentMonthCategoryBudgets.
export async function getDashboardRowsForMonth(
  householdId: string,
  year: number,
  month: number,
): Promise<
  (Pick<
    DashboardEntryRow,
    'month' | 'direction' | 'budgetedCents' | 'actualCents' | 'categoryId'
  > & {
    // True when the entry sits in the reserved Uncategorized category — Home's
    // categorize-nudge counts these (plus legacy null-category rows) without a second
    // scan; the categories join already exists, zero-new-join addition like categoryId.
    categoryIsSystem: boolean;
  })[]
> {
  const rows = await db
    .select({
      month: monthlyEntries.month,
      budgetedAmount: monthlyEntries.budgetedAmount,
      actualAmount: monthlyEntries.actualAmount,
      direction: categories.direction,
      categoryId: monthlyEntries.categoryId,
      categoryIsSystem: categories.isSystem,
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
    month: row.month,
    budgetedCents: parseAmountToCents(row.budgetedAmount),
    actualCents: row.actualAmount === null ? null : parseAmountToCents(row.actualAmount),
    direction: row.direction,
    categoryId: row.categoryId,
    categoryIsSystem: row.categoryIsSystem === true,
  }));
}

export interface NetWorthAccountRow extends NetWorthAccountInput {
  name: string;
}

// Full account list for the net-worth running-balance walk (spec.md Phase 4) — needs
// type/opening-balance/link fields getDashboardRows's join doesn't select, since that
// query only needs a bank account's *name* for display, not its balance-walk inputs.
// `name` here is for display only (e.g. the dashboard's per-account balances table) —
// lib/domain/net-worth.ts's pure functions only ever consume the NetWorthAccountInput
// subset of this shape.
export async function getAccountsForNetWorth(householdId: string): Promise<NetWorthAccountRow[]> {
  const rows = await db
    .select({
      id: bankAccounts.id,
      name: bankAccounts.name,
      accountType: bankAccounts.accountType,
      openingBalance: bankAccounts.openingBalance,
      linkedBankAccountId: bankAccounts.linkedBankAccountId,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.householdId, householdId));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    accountType: row.accountType,
    openingBalanceCents: parseAmountToCents(row.openingBalance),
    linkedBankAccountId: row.linkedBankAccountId,
  }));
}

export interface NetWorthPriorEntryRow {
  bankAccountId: string | null;
  direction: 'income' | 'expense' | null;
  amountCents: number;
}

// Lifetime carry-forward baseline for net worth (spec.md Phase 4) — everything before
// `year` folded down to one row per (bank_account_id, direction), not one row per
// historical entry. lib/domain/net-worth.ts's sumNetCentsByAccount just adds up signed
// amounts per effective account; feeding it pre-summed groups instead of individual
// entries produces the exact same total (addition is associative — sum-of-sums equals
// sum-of-everything), so that pure function needed no changes at all, only this
// query's shape did. Previously returned one row per entry ever recorded before this
// year — an unboundedly growing fetch+transfer+parse cost this file's own
// warnIfUnusuallyLarge comment already flagged; a household only ever has a handful of
// bank accounts, so this now returns at most 2 rows per account (one per direction)
// regardless of how many years of history exist. No warnIfUnusuallyLarge call here
// anymore — the returned row count no longer reflects entry-history size, so that
// warning's premise (catching unbounded growth) no longer applies to it.
export async function getAccountEntriesBeforeYear(
  householdId: string,
  year: number,
): Promise<NetWorthPriorEntryRow[]> {
  const rows = await db
    .select({
      bankAccountId: monthlyEntries.bankAccountId,
      direction: categories.direction,
      // Mirrors bestEstimateCents' COALESCE(actual_amount, budgeted_amount) pattern —
      // same "best available estimate" rule, just applied per-row before SQL sums
      // rather than in JS after fetching every row (see lib/domain/dashboard.ts's
      // bestEstimateCents doc comment for why this rule exists).
      total: sql<string>`sum(coalesce(${monthlyEntries.actualAmount}, ${monthlyEntries.budgetedAmount}))`,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .where(and(eq(monthlyEntries.householdId, householdId), lt(monthlyEntries.year, year)))
    .groupBy(monthlyEntries.bankAccountId, categories.direction);

  return rows.map((row) => ({
    bankAccountId: row.bankAccountId,
    direction: row.direction,
    amountCents: parseAmountToCents(row.total),
  }));
}

// Expense categories with their monthly budget cap, converted to cents (spec.md Phase 4's
// dashboard "budget-health widget") — the categories-only half of the budget-cap fetch,
// factored out so it can be shared by getCurrentMonthCategoryBudgets below (Settings ->
// Categories) and app/(app)/page.tsx (Home), which needs this same category list but
// computes spend from its own already-fetched current-month entries
// (getDashboardRowsForMonth) rather than running a second monthly_entries query. Doesn't
// touch monthly_entries at all, so unlike the entries half there was never a duplicate
// DB round-trip to eliminate here — sharing it is purely a dedup of the query text.
export async function getCurrentMonthExpenseCategories(
  householdId: string,
): Promise<CategoryBudgetInput[]> {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      monthlyBudget: categories.monthlyBudget,
    })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.direction, 'expense')));

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    monthlyBudgetCents: c.monthlyBudget === null ? null : parseAmountToCents(c.monthlyBudget),
  }));
}

// Current-month spend per expense category with a budget cap (spec.md Phase 4's
// dashboard "budget-health widget") — deliberately scoped to the real current
// month/year, independent of whatever year the dashboard itself is browsing: a
// monthly cap is inherently about "right now," not a historical or future year view.
// A thin wrapper over the same two independent sub-queries this always ran (categories
// via getCurrentMonthExpenseCategories, entries via its own monthly_entries query below)
// plus lib/domain/dashboard.ts's buildCategoryBudgetRows for the aggregation — the actual
// per-category spend math used to be inlined here directly; it moved out, unchanged, so
// app/(app)/page.tsx (Home) can run the identical aggregation over rows it already
// fetched instead of via a second call to this function (see getDashboardRowsForMonth's
// doc comment). This function's own output is unaffected by that split: same two
// queries, same math, same result, for its one remaining caller
// (app/(app)/settings/categories/page.tsx).
export async function getCurrentMonthCategoryBudgets(
  householdId: string,
): Promise<CategoryBudgetRow[]> {
  const { year, month } = currentYearMonth();

  const [categoryInputs, entryRows] = await Promise.all([
    getCurrentMonthExpenseCategories(householdId),
    db
      .select({
        categoryId: monthlyEntries.categoryId,
        budgetedAmount: monthlyEntries.budgetedAmount,
        actualAmount: monthlyEntries.actualAmount,
      })
      .from(monthlyEntries)
      .where(
        and(
          eq(monthlyEntries.householdId, householdId),
          eq(monthlyEntries.year, year),
          eq(monthlyEntries.month, month),
        ),
      ),
  ]);

  return buildCategoryBudgetRows(
    entryRows.map((row) => ({
      categoryId: row.categoryId,
      budgetedCents: parseAmountToCents(row.budgetedAmount),
      actualCents: row.actualAmount === null ? null : parseAmountToCents(row.actualAmount),
    })),
    categoryInputs,
  );
}

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

// Phase 6: cron routes have no user session, so they enumerate every household
// themselves rather than being handed one via requireUser() — each cron route then
// checks that household's own kill-switch (email_reminders/monthly_recap/auto_generate)
// before doing anything with it.
export async function getAllHouseholds(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: households.id, name: households.name }).from(households);
}

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

  return rows;
}

// Lifetime per-account cash position, ACTUALIZED entries only, no year bound — the
// affordability hero's cash lens (spec.md Phase 9 task 1: "Cash = opening balances +
// sumNetCentsByAccount over ACTUALIZED entries only, all years through today"). Same
// grouped-sum shape and reasoning as getAccountEntriesBeforeYear above (one row per
// (bank_account_id, direction) instead of one per entry, so a household's cash position
// is a handful of rows regardless of how many years of history exist) but with a
// `WHERE actual_amount IS NOT NULL` filter instead of a `year <` bound — an unpaid
// forecast row hasn't affected cash yet (see lib/domain/dashboard.ts's actualOnlyCents),
// so it must never be summed here regardless of which year it falls in.
export async function getActualizedCashRows(householdId: string): Promise<NetWorthPriorEntryRow[]> {
  const rows = await db
    .select({
      bankAccountId: monthlyEntries.bankAccountId,
      direction: categories.direction,
      total: sql<string>`sum(${monthlyEntries.actualAmount})`,
    })
    .from(monthlyEntries)
    .leftJoin(categories, eq(monthlyEntries.categoryId, categories.id))
    .where(and(eq(monthlyEntries.householdId, householdId), isNotNull(monthlyEntries.actualAmount)))
    .groupBy(monthlyEntries.bankAccountId, categories.direction);

  return rows.map((row) => ({
    bankAccountId: row.bankAccountId,
    direction: row.direction,
    amountCents: parseAmountToCents(row.total),
  }));
}

// Household members who've opted in to reminder/recap emails (users.notifyByEmail —
// off by default, spec.md Phase 6 UI: "recipient opt-in per member"). Any role can opt
// in; this isn't an owner-only notification.
export async function getEmailRecipients(
  householdId: string,
): Promise<{ id: string; email: string; name: string }[]> {
  return db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(and(eq(users.householdId, householdId), eq(users.notifyByEmail, true)));
}

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
export async function claimEmailSlot(
  householdId: string,
  type: EmailType,
  period: string,
): Promise<boolean> {
  const inserted = await db
    .insert(emailLog)
    .values({ householdId, type, period })
    .onConflictDoNothing()
    .returning({ id: emailLog.id });
  return inserted.length > 0;
}
