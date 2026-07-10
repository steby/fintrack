import { verifyCronRequest } from '../../../../lib/auth/cron';
import {
  getAllHouseholds,
  getDashboardRowsForMonth,
  getEmailRecipients,
  claimEmailSlot,
} from '../../../../lib/db/queries';
import { getEnabledHouseholdIds } from '../../../../lib/flags';
import { buildMonthlySeries } from '../../../../lib/domain/dashboard';
import { addMonths } from '../../../../lib/domain/recurring';
import { currentYearMonth } from '../../../../lib/domain/today';
import { sendEmail } from '../../../../lib/email/resend';
import { recapEmailHtml } from '../../../../lib/email/templates';
import { MONTH_SHORT } from '../../../../lib/format';
import { logger } from '../../../../lib/log';

// spec.md Phase 6: "month-end summary email." Scheduled (vercel.json) to fire on the
// 1st of each month, summarizing the month that just closed — not the in-progress
// current month, which wouldn't be a "recap" yet. `period` is that closed month's
// "YYYY-MM", one recap per household per month (same dedup mechanism as reminders).
export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const target = addMonths(currentYearMonth(), -1);
  const period = `${target.year}-${String(target.month).padStart(2, '0')}`;
  const monthName = MONTH_SHORT[target.month - 1];

  const allHouseholds = await getAllHouseholds();
  // One query for every household's monthly_recap flag instead of one query PER
  // household (lib/flags.ts's getEnabledHouseholdIds) — same reasoning as
  // api/cron/generate's identical change. Only the flag gate moved; the claim-after-
  // recipients-check ordering invariant below is untouched.
  const enabledIds = await getEnabledHouseholdIds(
    allHouseholds.map((h) => h.id),
    'monthly_recap',
  );
  let sent = 0;
  let skippedEmpty = 0;
  let skippedNoRecipients = 0;
  let alreadyClaimed = 0;

  for (const household of allHouseholds) {
    if (!enabledIds.has(household.id)) continue;
    // See app/api/cron/reminders/route.ts's identical try/catch comment: one
    // household's failure must not abort the rest of the loop. A failure here happens
    // before claimEmailSlot is reached (see its call site below), so it's naturally
    // retried on the next scheduled invocation.
    try {
      const rows = await getDashboardRowsForMonth(household.id, target.year, target.month);
      const point = buildMonthlySeries(rows)[target.month - 1];
      const isEmptyMonth =
        point.budgetedIncomeCents === 0 &&
        point.actualIncomeCents === 0 &&
        point.budgetedExpenseCents === 0 &&
        point.actualExpenseCents === 0;
      if (isEmptyMonth) {
        skippedEmpty++;
        continue; // symmetric with the reminders route's "no upcoming bills" no-op
      }

      const recipients = await getEmailRecipients(household.id);
      if (recipients.length === 0) {
        skippedNoRecipients++;
        continue;
      }

      // Claimed only once we know there's actually something to send — see
      // app/api/cron/reminders/route.ts's identical comment for why this must happen
      // after the recipients check, not before.
      if (!(await claimEmailSlot(household.id, 'recap', period))) {
        alreadyClaimed++;
        continue;
      }

      const html = recapEmailHtml(household.name, { monthName, year: target.year, point });
      for (const recipient of recipients) {
        const ok = await sendEmail({
          to: recipient.email,
          subject: `${monthName} ${target.year} recap — ${household.name}`,
          html,
        });
        if (ok) {
          sent++;
        } else {
          logger.error(
            { householdId: household.id, recipient: recipient.email },
            'Recap email failed to send after retries',
          );
        }
      }
    } catch (err) {
      logger.error({ err, householdId: household.id }, 'Cron recap failed for household');
    }
  }

  return Response.json({ sent, skippedEmpty, skippedNoRecipients, alreadyClaimed });
}
