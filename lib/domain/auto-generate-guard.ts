// Short-TTL per-household guard against re-running the /monthly page's auto-generate
// transaction (a real SELECT + INSERT, not just the already-cached flag check) on
// every load — switching between visible months/views is a full server render that
// hits the on-load hook again with the exact same "today"-derived generation window
// each time, since that window depends on the real calendar date, not on which month
// the user is currently looking at.
//
// Deliberately NOT used by generateEntriesForRange (lib/generate-entries.ts) itself —
// the manual "Generate forecast" button (app/actions/recurring.ts's generateAction)
// and the generate cron route must always run fresh, since both are explicit/
// scheduled triggers where staleness isn't acceptable. This guard is wired up only at
// app/(app)/monthly/page.tsx's on-load call site.
//
// A factory (not a bare module-level Map) so this file stays unit-testable: each
// createAutoGenerateGuard() call gets its own isolated Map, and `now` is injectable
// throughout, same as every other "what does 'now'/'today' mean" function in this
// codebase (lib/domain/today.ts) — deterministic tests, no reliance on wall-clock
// timing or sleeping in a test to observe TTL expiry.
export const DEFAULT_AUTO_GENERATE_GUARD_TTL_MS = 60_000;

export interface AutoGenerateGuard {
  shouldRun(householdId: string, now?: Date): boolean;
  recordRun(householdId: string, now?: Date): void;
}

export function createAutoGenerateGuard(
  ttlMs: number = DEFAULT_AUTO_GENERATE_GUARD_TTL_MS,
): AutoGenerateGuard {
  const lastRunAt = new Map<string, number>();

  return {
    shouldRun(householdId, now = new Date()) {
      const last = lastRunAt.get(householdId);
      return last === undefined || now.getTime() - last > ttlMs;
    },
    recordRun(householdId, now = new Date()) {
      lastRunAt.set(householdId, now.getTime());
    },
  };
}

// Process-lifetime singleton, same pattern as lib/flags.ts's isEnabled() cache — a
// server-rendered page needs one guard shared across every request it handles within
// this server instance, not a fresh one per render.
export const autoGenerateGuard = createAutoGenerateGuard();
