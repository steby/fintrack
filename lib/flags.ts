import { eq, and } from 'drizzle-orm';
import { db } from './db';
import { householdSettings } from './db/schema';

// Kill-switches (spec.md Feature Matrix): runtime-toggleable per household without a
// redeploy, backed by household_settings rows rather than an env var — Vercel env vars
// require a rebuild to change, which defeats the point of an incident kill-switch.
export type KillSwitchKey = 'auto_generate' | 'csv_import' | 'email_reminders' | 'monthly_recap';

const KILL_SWITCH_DEFAULTS: Record<KillSwitchKey, boolean> = {
  auto_generate: true,
  csv_import: false,
  email_reminders: false,
  monthly_recap: false,
};

// ~30s in-memory cache (spec.md Phase 0 decision), scoped per (household, flag) pair —
// a process-lifetime Map, not request-scoped, so it's shared across requests within one
// server instance. Every request paying a DB round trip just to check "is this feature
// on" would be wasteful for a check this cheap to cache; 30s bounds how stale a toggle
// can appear after an owner flips it.
const CACHE_TTL_MS = 30_000;
interface CacheEntry {
  value: boolean;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

function cacheKey(householdId: string, flag: KillSwitchKey): string {
  return `${householdId}:${flag}`;
}

export async function isEnabled(householdId: string, flag: KillSwitchKey): Promise<boolean> {
  const key = cacheKey(householdId, flag);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const [row] = await db
    .select({ value: householdSettings.value })
    .from(householdSettings)
    .where(and(eq(householdSettings.householdId, householdId), eq(householdSettings.key, flag)))
    .limit(1);

  // No row yet means "never explicitly set" — falls back to the flag's documented
  // default (spec.md Feature Matrix), not to false. `auto_generate` in particular
  // defaults ON, so a household that's never touched this setting still gets it.
  // `flag` is narrowed to the 4-value KillSwitchKey union at compile time (same false
  // positive as lib/auth/rbac.ts's MATRIX[role]), never arbitrary/untrusted input.
  // eslint-disable-next-line security/detect-object-injection
  const value = row ? row.value === 'true' : KILL_SWITCH_DEFAULTS[flag];
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function setFlag(
  householdId: string,
  flag: KillSwitchKey,
  value: boolean,
): Promise<void> {
  await db
    .insert(householdSettings)
    .values({ householdId, key: flag, value: String(value) })
    .onConflictDoUpdate({
      target: [householdSettings.householdId, householdSettings.key],
      set: { value: String(value) },
    });
  // Evicted, not updated in place — the next isEnabled() call re-reads from the DB and
  // re-populates the cache, so this function doesn't need to duplicate the "what does
  // the DB row actually say" logic above.
  cache.delete(cacheKey(householdId, flag));
}
