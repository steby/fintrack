import { eq, and } from 'drizzle-orm';
import { db } from './db';
import { householdSettings } from './db/schema';

// Generic household_settings accessor for non-kill-switch keys (spec.md Phase 9:
// `affordability_horizon`) — lib/flags.ts's isEnabled/setFlag already own the
// boolean-only, cached, KillSwitchKey-typed subset of this same table; this is the
// free-form string-value sibling for everything else that doesn't fit that shape.
// Deliberately does NOT widen KillSwitchKey (a horizon isn't a kill-switch: it has
// nothing to do with disabling a misbehaving feature in an incident) and deliberately
// has NO cache, unlike isEnabled's 30s TTL — every current caller is a single
// per-request read on Home's render path, not a hot loop worth caching, and skipping
// the cache avoids a second, independent staleness window to reason about on top of
// flags.ts's existing one.

export async function getSetting(householdId: string, key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: householdSettings.value })
    .from(householdSettings)
    .where(and(eq(householdSettings.householdId, householdId), eq(householdSettings.key, key)))
    .limit(1);
  return row?.value ?? null;
}

export async function setSetting(householdId: string, key: string, value: string): Promise<void> {
  await db
    .insert(householdSettings)
    .values({ householdId, key, value })
    .onConflictDoUpdate({
      target: [householdSettings.householdId, householdSettings.key],
      set: { value },
    });
}
