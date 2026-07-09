import { verifyCronRequest } from '../../../../lib/auth/cron';
import { getAllHouseholds } from '../../../../lib/db/queries';
import { isEnabled } from '../../../../lib/flags';
import { generateEntriesForRange } from '../../../../lib/generate-entries';
import { addMonths } from '../../../../lib/domain/recurring';
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

  const allHouseholds = await getAllHouseholds();
  let processed = 0;
  let insertedTotal = 0;

  for (const household of allHouseholds) {
    if (!(await isEnabled(household.id, 'auto_generate'))) continue;

    const now = new Date();
    const from = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
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
