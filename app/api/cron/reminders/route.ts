import { verifyCronRequest } from '../../../../lib/auth/cron';
import {
  getAllHouseholds,
  getUpcomingBillCandidates,
  getEmailRecipients,
  claimEmailSlot,
} from '../../../../lib/db/queries';
import { isEnabled } from '../../../../lib/flags';
import { selectUpcomingBills } from '../../../../lib/domain/reminders';
import { utcStartOfDay } from '../../../../lib/domain/today';
import { addMonths } from '../../../../lib/domain/recurring';
import { sendEmail } from '../../../../lib/email/resend';
import { reminderEmailHtml } from '../../../../lib/email/templates';
import { logger } from '../../../../lib/log';

// spec.md Phase 6: one reminder digest email per household per UTC calendar day,
// covering every unpaid bill due within the next 3 days. `period` is that UTC date —
// claiming the ledger slot for it is what makes a cron double-fire on the same day a
// no-op (spec.md: "cron double-fire must not double-send").
export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = utcStartOfDay();
  const period = today.toISOString().slice(0, 10);
  const from = { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };
  // Both the current and next month, so a bill due in the first few days of next month
  // is still visible within the 3-day window even though it lives in a different
  // monthly_entries row.
  const buckets = [from, addMonths(from, 1)];

  const allHouseholds = await getAllHouseholds();
  let sent = 0;
  let skippedNoBills = 0;
  let skippedNoRecipients = 0;
  let alreadyClaimed = 0;

  for (const household of allHouseholds) {
    // One household's failure (a transient DB hiccup fetching candidates/recipients,
    // say) must not abort every OTHER household still left in this loop — matches
    // api/cron/generate's same try/catch. Without this, a single bad household could
    // silently skip everyone after it for the rest of the day, and — worse — leave that
    // household's ledger slot claimed with nothing actually sent (claimEmailSlot runs
    // first; see its own comment), so it's not even retried until tomorrow.
    try {
      if (!(await isEnabled(household.id, 'email_reminders'))) continue;

      // Claimed BEFORE fetching/sending (see lib/db/queries.ts's claimEmailSlot comment
      // for why a failed send afterward isn't retried until the next scheduled period).
      if (!(await claimEmailSlot(household.id, 'reminder', period))) {
        alreadyClaimed++;
        continue;
      }

      const candidates = await getUpcomingBillCandidates(household.id, buckets);
      const bills = selectUpcomingBills(candidates, today);
      if (bills.length === 0) {
        skippedNoBills++;
        continue; // spec.md: "no upcoming bills (no empty email)"
      }

      const recipients = await getEmailRecipients(household.id);
      if (recipients.length === 0) {
        skippedNoRecipients++;
        continue;
      }

      const html = reminderEmailHtml(household.name, bills);
      for (const recipient of recipients) {
        const ok = await sendEmail({
          to: recipient.email,
          subject: `Upcoming bills — ${household.name}`,
          html,
        });
        if (ok) {
          sent++;
        } else {
          logger.error(
            { householdId: household.id, recipient: recipient.email },
            'Reminder email failed to send after retries',
          );
        }
      }
    } catch (err) {
      logger.error({ err, householdId: household.id }, 'Cron reminders failed for household');
    }
  }

  return Response.json({ sent, skippedNoBills, skippedNoRecipients, alreadyClaimed });
}
