// Split from lib/db/queries.ts (batch-4 maintainability pass) — see that file's
// barrel comment. Same household-scoping and money-in-cents conventions throughout.
import { db } from '../index';
import { and, eq } from 'drizzle-orm';
import { households, users, emailLog } from '../schema';

// Matches lib/flags.ts's KillSwitchKey pattern: a small, hand-written union rather than
// derived from the pgEnum, since Drizzle doesn't export a ready-made TS type for enum
// columns and this is only ever used at these two call sites.
export type EmailType = 'reminder' | 'recap';

// Phase 6: cron routes have no user session, so they enumerate every household
// themselves rather than being handed one via requireUser() — each cron route then
// checks that household's own kill-switch (email_reminders/monthly_recap/auto_generate)
// before doing anything with it.
export async function getAllHouseholds(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: households.id, name: households.name }).from(households);
}

// Household members who've opted in to reminder/recap emails (users.notifyByEmail —
// off by default, spec.md Phase 6 UI: "recipient opt-in per member"). Any role can opt
// in; this isn't an owner-only notification.
export async function getEmailRecipients(
  householdId: string,
): Promise<{ id: string; email: string; name: string }[]> {
  return db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(and(eq(users.householdId, householdId), eq(users.notifyByEmail, true)));
}

export async function claimEmailSlot(
  householdId: string,
  type: EmailType,
  period: string,
): Promise<boolean> {
  const inserted = await db
    .insert(emailLog)
    .values({ householdId, type, period })
    .onConflictDoNothing()
    .returning({ id: emailLog.id });
  return inserted.length > 0;
}
