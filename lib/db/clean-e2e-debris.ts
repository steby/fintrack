import 'dotenv/config';
import { like } from 'drizzle-orm';
import { bankAccounts, categories, monthlyEntries, recurringSchedule, users } from './schema';

// Cleans E2E test debris left behind when a run is killed mid-test. This CI workflow uses
// `concurrency: cancel-in-progress: true`, so a rapid sequence of pushes — normal during
// active development — cancels an in-flight E2E run before its own afterAll cleanup
// executes, leaving orphaned rows tagged with an "E2E "/"e2e-" prefix on the long-lived,
// shared `ci` Neon branch. Safe to run indefinitely: matching zero rows is the normal
// steady state.
//
// This file previously also purged a one-time list of real-named rows left over from
// before lib/db/seed.ts was genericized (2026-07-09, ahead of making the repo public).
// That cleanup ran successfully exactly once (see PROGRESS.md) and the list was removed
// afterward rather than kept as permanent dead weight — critically, that list had to name
// the real values being purged (real personal/financial data), so leaving it in a
// committed, now-public file defeated the entire point of the genericization it was
// cleaning up after. If a similar one-time purge is ever needed again, do it as an
// uncommitted local script against the target branch, not a permanent committed one.
//
// CI-only by design (guarded below): the E2E-prefix convention is itself the scoping
// mechanism (not household_id) — there's no single "right" household to scope to on a
// shared branch used by many ephemeral test households — which makes this unsafe to run
// against a real/shared database outside of CI without a deliberate override.
//
// ./schema and drizzle-orm are safe to import statically here (unlike ./index/../log
// below) — schema.ts has no dependency on lib/env.ts, so importing it doesn't trigger
// eager env validation.

async function main() {
  if (process.env.CI !== 'true') {
    throw new Error(
      'db:clean-e2e-debris refuses to run outside CI (process.env.CI !== "true"). ' +
        'Its DELETE patterns are broad by name/prefix, not household-scoped, and are ' +
        'only safe against the shared `ci` Neon branch this workflow provisions — ' +
        'never point it at a local/dev/production DATABASE_URL.',
    );
  }

  // Dynamically imported *after* the CI-only check above, so a stray local run fails with
  // this script's own clear message instead of tripping lib/env.ts's eager validation
  // first — same reasoning as lib/db/seed.ts's dynamic import of ./index/../log.
  const [{ pool, db }, { logger }] = await Promise.all([import('./index'), import('../log')]);

  try {
    const result = await db.transaction(async (tx) => {
      const e2eEntries = await tx
        .delete(monthlyEntries)
        .where(like(monthlyEntries.item, 'E2E %'))
        .returning({ id: monthlyEntries.id });
      const e2eItems = await tx
        .delete(recurringSchedule)
        .where(like(recurringSchedule.item, 'E2E %'))
        .returning({ id: recurringSchedule.id });
      const e2eCategories = await tx
        .delete(categories)
        .where(like(categories.name, 'E2E %'))
        .returning({ id: categories.id });
      const e2eAccounts = await tx
        .delete(bankAccounts)
        .where(like(bankAccounts.name, 'E2E %'))
        .returning({ id: bankAccounts.id });
      const e2eUsers = await tx
        .delete(users)
        .where(like(users.email, 'e2e-%@example.com'))
        .returning({ id: users.id });

      return {
        e2eEntries: e2eEntries.length,
        e2eItems: e2eItems.length,
        e2eCategories: e2eCategories.length,
        e2eAccounts: e2eAccounts.length,
        e2eUsers: e2eUsers.length,
      };
    });

    logger.info(result, 'Cleaned stale E2E debris (idempotent).');
    await pool.end();
  } catch (err) {
    // The real logger is available here (the dynamic import above already succeeded), so
    // failures after that point — DB unreachable, transaction failure, etc. — get proper
    // structured logging with a stack trace, not just the outer catch's bare message.
    logger.error({ err }, 'E2E debris cleanup failed');
    process.exit(1);
  }
}

main().catch((err) => {
  // Only reachable for failures *before* the dynamic imports above succeed — i.e. the
  // CI-only guard throw — since the real logger isn't available yet at that point.
  console.error('E2E debris cleanup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
