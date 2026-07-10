import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { and, eq, like, lt, ne } from 'drizzle-orm';
import {
  bankAccounts,
  categories,
  households,
  monthlyEntries,
  recurringSchedule,
  users,
} from './schema';

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

// Second pass, added for Phase 6: catches orphaned households from ANY test source
// (not just E2E-prefixed rows) — integration tests each clean up their own household
// at the end of their own `it()` block, but the same cancel-in-progress trigger
// explained above can leave one behind before that cleanup runs. Every other query in
// this codebase is household-scoped, so leaked orphans were invisible to correctness —
// until Phase 6's cron routes (lib/db/queries.ts's getAllHouseholds) became the first
// code to ever iterate literally every household in the DB, at which point months of
// accumulated debris turned an invisible-but-harmless leak into real, observed test
// timeouts (188 integration tests include ones that do real per-household transactional
// work, e.g. api/cron/generate's route).
//
// Age-based rather than name/prefix-based: integration test files don't share one
// naming convention the way E2E specs do (each file picks its own household labels),
// so there's no single pattern to match. Every legitimate household from this workflow
// is deleted within seconds of being created by its own test; anything past this
// window is unambiguously orphaned, never a real in-flight test. The one household
// this must never touch — the real seeded owner's, looked up by SEED_OWNER_EMAIL
// exactly like lib/db/seed.ts does — is excluded explicitly, not just "hopefully old
// enough."
//
// Permanently lowered from 1 hour to 5 minutes on 2026-07-10, after the 1-hour value
// caused the same real failure twice in one night: months of accumulated debris first
// tipped getAllHouseholds()-driven cron route tests (reminders/recap/generate) into
// hanging for their full 15s test timeout, then a burst of ~10 CI runs within about an
// hour (several Dependabot PR rebases/reruns/merges in quick succession) produced
// enough of its OWN fresh failed-test debris to re-bloat the household count before
// the hourly sweep ever got a chance to clear any of it — "debris accumulates faster
// than the sweep clears it" is a real, recurring failure mode at 1 hour, not a
// one-off. Both incidents were fixed by temporarily dropping this same value to 5
// minutes and confirming a clean run, which is exactly this value now, permanently.
// Nothing about 5 minutes is less safe than 1 hour: a legitimate household's own test
// always cleans it up within seconds (observed tonight: even a 21-test integration
// file finishes in under 50s total), so the threshold only needs enough margin to
// never race a real in-flight test — 5 minutes has that margin many times over, while
// also self-healing debris from a busy CI burst in minutes instead of up to an hour.
// Exported so clean-e2e-debris.integration.test.ts can import the real value instead of
// hand-duplicating it — two independently maintained copies of this number already drifted
// out of sync once tonight (this file's own log message, three edits below, still said
// ">1h old" for a full commit after this value became 5 minutes).
export const ORPHAN_HOUSEHOLD_AGE_MS = 5 * 60 * 1000;

// Extracted from main() so it's testable against a real (local/dev) DB without going
// through this file's hard CI-only guard or its dynamic ./index import — see
// clean-e2e-debris.integration.test.ts. `now` is injectable for the same reason every
// other "what does 'today' mean" function in this codebase takes one (lib/domain/
// today.ts) — deterministic tests, no reliance on wall-clock timing.
export async function cleanOrphanedHouseholds(
  db: typeof import('./index').db,
  seedOwnerEmail: string | undefined,
  now: Date = new Date(),
): Promise<{ orphanedHouseholds: number; skippedUnverifiedSeedOwner: boolean }> {
  let seedOwnerHouseholdId: string | undefined;
  if (seedOwnerEmail) {
    const [seedOwner] = await db
      .select({ householdId: users.householdId })
      .from(users)
      .where(eq(users.email, seedOwnerEmail));
    if (!seedOwner) {
      // Fail CLOSED, not open: a configured SEED_OWNER_EMAIL that doesn't resolve to a
      // real row (a rotated secret, or the very first run against a fresh DB) means we
      // can't verify which household to protect — skip the whole sweep rather than
      // deleting everything unprotected. Self-heals within one run: the "Seed
      // database" CI step immediately after this one creates/confirms the owner under
      // whatever email is currently configured, so the next run's lookup succeeds and
      // normal cleanup resumes on its own.
      return { orphanedHouseholds: 0, skippedUnverifiedSeedOwner: true };
    }
    seedOwnerHouseholdId = seedOwner.householdId;
  }

  const cutoff = new Date(now.getTime() - ORPHAN_HOUSEHOLD_AGE_MS);
  const orphanedHouseholds = await db
    .delete(households)
    .where(
      seedOwnerHouseholdId
        ? and(lt(households.createdAt, cutoff), ne(households.id, seedOwnerHouseholdId))
        : lt(households.createdAt, cutoff),
    )
    .returning({ id: households.id });

  return { orphanedHouseholds: orphanedHouseholds.length, skippedUnverifiedSeedOwner: false };
}

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

    const orphanResult = await cleanOrphanedHouseholds(db, process.env.SEED_OWNER_EMAIL);
    if (orphanResult.skippedUnverifiedSeedOwner) {
      logger.warn(
        orphanResult,
        'SEED_OWNER_EMAIL is configured but no matching user was found — skipped the ' +
          'orphaned-household sweep this run (failing closed) instead of deleting ' +
          'unprotected. Should self-resolve once the Seed database step (next) runs.',
      );
    } else {
      logger.info(
        orphanResult,
        // Derived from the constant, not hand-typed — this exact message already went
        // stale once (said ">1h old" for a full commit after the threshold became 5
        // minutes), because a literal duration in a log string has no way to notice
        // the constant it's describing changed underneath it.
        `Cleaned orphaned (>${ORPHAN_HOUSEHOLD_AGE_MS / 60_000}m old) households from any test source (idempotent).`,
      );
    }

    await pool.end();
  } catch (err) {
    // The real logger is available here (the dynamic import above already succeeded), so
    // failures after that point — DB unreachable, transaction failure, etc. — get proper
    // structured logging with a stack trace, not just the outer catch's bare message.
    logger.error({ err }, 'E2E debris cleanup failed');
    process.exit(1);
  }
}

// Only auto-runs when this file is the actual entry point (`tsx lib/db/clean-e2e-debris.ts`,
// per package.json's db:clean-e2e-debris script) — NOT when it's imported for
// cleanOrphanedHouseholds, as clean-e2e-debris.integration.test.ts now does. Without
// this guard, importing this module for its one testable export would also trigger
// this unconditional call, which throws on the CI-only check and calls
// process.exit(1) — fine for a real CLI invocation, but it would kill the test
// worker process for anything that merely imports this file. fileURLToPath, not a raw
// string compare against import.meta.url, so this is correct on Windows (backslash
// paths) as well as POSIX.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // Only reachable for failures *before* the dynamic imports above succeed — i.e. the
    // CI-only guard throw — since the real logger isn't available yet at that point.
    console.error('E2E debris cleanup failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
