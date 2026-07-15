// Split from lib/db/queries.ts (batch-4 maintainability pass) — see that file's
// barrel comment. Same household-scoping and money-in-cents conventions throughout.
import { db } from '../index';
import { and, eq } from 'drizzle-orm';
import { categories, bankAccounts, users } from '../schema';
import { logger } from '../../log';
import { isUnusuallyLargeRowCount } from '../../domain/query-limits';

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
export function warnIfUnusuallyLarge(queryName: string, householdId: string, rowCount: number) {
  if (isUnusuallyLargeRowCount(rowCount)) {
    logger.warn({ householdId, rowCount }, `${queryName} returned an unusually large row count`);
  }
}
