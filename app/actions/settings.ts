'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth/guards';
import { setSetting } from '../../lib/settings';

export type SetHorizonActionState = { error?: string; success?: boolean } | undefined;

const horizonSchema = z.object({ horizon: z.enum(['month', '7', '14', '30']) });

// Home's forecast-horizon picker (spec.md Phase 9) — requireRole('write') is owner OR
// member (lib/auth/rbac.ts's MATRIX), not requireRole('manage_settings') like
// app/actions/notifications.ts's kill-switch toggles: a forecast horizon is a personal
// "how far ahead do I want to look" viewing preference shared household-wide by this
// household_settings row, not an owner-only household policy toggle. Re-validated on
// read too (lib/domain/affordability.ts's parseHorizon), per spec.md's trust-boundary
// note — a tampered/garbage `household_settings` row is exactly as untrusted as a
// forged form post, so both paths go through the same parser.
export async function setHorizonAction(
  _prevState: SetHorizonActionState,
  formData: FormData,
): Promise<SetHorizonActionState> {
  const actingUser = await requireRole('write');

  const parsed = horizonSchema.safeParse({ horizon: formData.get('horizon') });
  if (!parsed.success) {
    return { error: 'Invalid horizon.' };
  }

  await setSetting(actingUser.householdId, 'affordability_horizon', parsed.data.horizon);
  revalidatePath('/');
  return { success: true };
}
