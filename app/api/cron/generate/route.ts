import { verifyCronRequest } from '../../../../lib/auth/cron';
import { getAllHouseholds } from '../../../../lib/db/queries';
import { getEnabledHouseholdIds } from '../../../../lib/flags';
import { generateEntriesForRange } from '../../../../lib/generate-entries';
import { addMonths } from '../../../../lib/domain/recurring';
import { currentYearMonth } from '../../../../lib/domain/today';
import { logger } from '../../../../lib/log';

// Backstop for households that don't load /monthly regularly. That page's own on-load
// hook (app/(app)/monthly/page.tsx) keeps the next 3 months materialized on every
// visit, but a household that goes weeks without opening the app would otherwise never
// get its rolling window refreshed. Same auto_generate kill-switch, same 3-month
// window, same idempotent generateEntriesForRange (ON CONFLICT DO NOTHING) — this
// route just triggers it on a schedule instead of a page view, so no dedup ledger is
// needed here the way reminders/recap need one.
export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Computed once, outside the loop — every household gets the same generation window
  // for this invocation, matching reminders/recap's "one shared today" pattern. Inside
  // the loop, a slow run straddling a UTC day/month rollover could give later
  // households a different window than earlier ones.
  const from = currentYearMonth();

  const allHouseholds = await getAllHouseholds();
  // One query for every household's auto_generate flag instead of one query PER
  // household (lib/flags.ts's getEnabledHouseholdIds) — the flag check no longer needs
  // its own try/catch inside the loop below since it now happens once, up front,
  // outside the per-household guard; a failure here fails the whole invocation loudly
  // (surfacing in Vercel's cron logs) rather than being silently swallowed per household.
  const enabledIds = await getEnabledHouseholdIds(
    allHouseholds.map((h) => h.id),
    'auto_generate',
  );
  let processed = 0;
  let insertedTotal = 0;

  for (const household of allHouseholds) {
    if (!enabledIds.has(household.id)) continue;
    // generateEntriesForRange itself is still individually guarded: a transient
    // failure for one household (e.g. a DB hiccup mid-transaction) must not abort
    // every household still left in the loop, matching reminders/recap's identical
    // per-household guard.
    try {
      insertedTotal += await generateEntriesForRange(household.id, from, addMonths(from, 2));
      processed++;
    } catch (err) {
      // One household's failure (e.g. a transient DB hiccup) shouldn't stop the rest
      // of the loop from running — log and move on, matching spec.md's "log + degrade"
      // failure mode for this phase.
      logger.error({ err, householdId: household.id }, 'Cron generate failed for household');
    }
  }

  return Response.json({ processed, insertedTotal });
}
