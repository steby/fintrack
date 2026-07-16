// Split from lib/db/queries.ts (batch-4 maintainability pass) — see that file's
// barrel comment. Same household-scoping and money-in-cents conventions throughout.
import { db } from '../index';
import { and, eq } from 'drizzle-orm';
import { categories, bankAccounts, users } from '../schema';

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

// "Is this category the household's reserved system (Uncategorized) row" — the named
// pre-check for actions that must refuse a mutation on it with a SPECIFIC error message
// (e.g. updateCategoryAction pinning its direction). Actions whose protection must be
// atomic with the write itself (deleteCategoryAction) embed eq(isSystem, false) in the
// write's own WHERE instead — both mechanisms exist on purpose; this helper is the one
// to reach for when adding a new category-mutating action's validation (review altitude
// finding: the guard used to be re-derived ad hoc per action with nothing to grep for).
export async function isSystemCategory(householdId: string, categoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, categoryId),
        eq(categories.householdId, householdId),
        eq(categories.isSystem, true),
      ),
    )
    .limit(1);
  return row !== undefined;
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
