'use server';

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../../lib/db';
import { users } from '../../lib/db/schema';
import { requireRole } from '../../lib/auth/guards';

export type MemberActionState = { error?: string; success?: boolean } | undefined;

const changeRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['owner', 'member', 'viewer']),
});

export async function changeMemberRoleAction(
  _prevState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const actingUser = await requireRole('manage_members');

  const parsed = changeRoleSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }
  if (parsed.data.userId === actingUser.id) {
    return { error: 'You cannot change your own role.' };
  }

  // household_id is part of the WHERE clause, not just the lookup key — without it, an
  // owner could change the role of a user in a DIFFERENT household by guessing/reusing
  // a UUID (spec.md threat note: missing household_id filter -> cross-tenant leak).
  const result = await db
    .update(users)
    .set({ role: parsed.data.role })
    .where(and(eq(users.id, parsed.data.userId), eq(users.householdId, actingUser.householdId)))
    .returning({ id: users.id });

  if (!result[0]) {
    return { error: 'Member not found.' };
  }
  return { success: true };
}

const removeMemberSchema = z.object({ userId: z.string().uuid() });

export async function removeMemberAction(
  _prevState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const actingUser = await requireRole('manage_members');

  const parsed = removeMemberSchema.safeParse({ userId: formData.get('userId') });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }
  if (parsed.data.userId === actingUser.id) {
    return { error: 'You cannot remove yourself.' };
  }

  // Same cross-household scoping as changeMemberRoleAction. Deleting the user also
  // cascades to their sessions (sessions.user_id ON DELETE CASCADE), so a removed
  // member's active sessions are invalidated immediately, not just on next expiry.
  const result = await db
    .delete(users)
    .where(and(eq(users.id, parsed.data.userId), eq(users.householdId, actingUser.householdId)))
    .returning({ id: users.id });

  if (!result[0]) {
    return { error: 'Member not found.' };
  }
  return { success: true };
}
