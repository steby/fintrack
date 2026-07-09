'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { users } from '../../lib/db/schema';
import { requireRole, requireUser } from '../../lib/auth/guards';
import { setFlag } from '../../lib/flags';
import { sendEmail } from '../../lib/email/resend';

export type ToggleFlagActionState = { error?: string; success?: boolean } | undefined;

const toggleSchema = z.object({ enabled: z.enum(['true', 'false']) });

// Owner-only (manage_settings), mirrors app/actions/import.ts's toggleCsvImportAction —
// same kill-switch pattern (household_settings-backed, runtime-toggleable), different
// flag. Two near-identical actions rather than one parameterized by flag name: matches
// this codebase's established preference (see CLAUDE.md) for a little duplication over
// a premature abstraction, and toggleCsvImportAction already set this exact precedent.
export async function toggleEmailRemindersAction(
  _prevState: ToggleFlagActionState,
  formData: FormData,
): Promise<ToggleFlagActionState> {
  const actingUser = await requireRole('manage_settings');
  const parsed = toggleSchema.safeParse({ enabled: formData.get('enabled') });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }
  await setFlag(actingUser.householdId, 'email_reminders', parsed.data.enabled === 'true');
  revalidatePath('/settings/notifications');
  return { success: true };
}

export async function toggleMonthlyRecapAction(
  _prevState: ToggleFlagActionState,
  formData: FormData,
): Promise<ToggleFlagActionState> {
  const actingUser = await requireRole('manage_settings');
  const parsed = toggleSchema.safeParse({ enabled: formData.get('enabled') });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }
  await setFlag(actingUser.householdId, 'monthly_recap', parsed.data.enabled === 'true');
  revalidatePath('/settings/notifications');
  return { success: true };
}

// Self-service only — a member opts THEMSELVES in or out of reminder/recap emails, not
// anyone else's row (spec.md: "recipient opt-in per member"). requireUser, not
// requireRole('manage_settings'): every role, including viewers, may want these
// emails even though only the owner controls whether the feature is on at all.
export async function updateNotifyByEmailAction(
  _prevState: ToggleFlagActionState,
  formData: FormData,
): Promise<ToggleFlagActionState> {
  const actingUser = await requireUser();
  const parsed = toggleSchema.safeParse({ enabled: formData.get('enabled') });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  await db
    .update(users)
    .set({ notifyByEmail: parsed.data.enabled === 'true' })
    .where(eq(users.id, actingUser.id));
  revalidatePath('/settings/notifications');
  return { success: true };
}

// Self-service "send test email" — lets a member verify their own address/opt-in
// wiring works without waiting for the next cron fire. Deliberately bypasses the
// email_reminders/monthly_recap kill-switches and the dedup ledger entirely: this is a
// one-off deliverability check, not the real notification path, and always targets the
// acting user's own address (never an arbitrary recipient from form input).
export async function sendTestEmailAction(
  // Both required by useActionState's signature, neither read: this action takes no
  // input (always targets the caller's own address) and ignores the previous result.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: ToggleFlagActionState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData,
): Promise<ToggleFlagActionState> {
  const actingUser = await requireUser();
  const ok = await sendEmail({
    to: actingUser.email,
    subject: 'FinTrack test email',
    html: '<p>This is a test email from FinTrack. If you received this, your notification settings are working.</p>',
  });
  if (!ok) {
    return { error: 'Failed to send test email. Check server logs.' };
  }
  return { success: true };
}
