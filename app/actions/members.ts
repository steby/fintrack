'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
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

  const result = await db.transaction(async (tx) => {
    // Lock every owner row in the household before checking anything — without this,
    // two owners concurrently demoting each other (each independently passing the
    // requireRole check above) can both read "at least one other owner exists" as true
    // and both writes commit, leaving zero owners with no way to ever manage the
    // household again. FOR UPDATE forces the second transaction to wait for the first
    // to commit (and see its result) rather than reading stale, pre-write state.
    const owners = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.householdId, actingUser.householdId), eq(users.role, 'owner')))
      .for('update');

    // household_id is part of the WHERE clause, not just the lookup key — without it, an
    // owner could change the role of a user in a DIFFERENT household by guessing/reusing
    // a UUID (spec.md threat note: missing household_id filter -> cross-tenant leak).
    const target = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.id, parsed.data.userId), eq(users.householdId, actingUser.householdId)))
      .limit(1);
    if (!target[0]) {
      return { error: 'Member not found.' } as const;
    }

    const wouldLeaveZeroOwners =
      target[0].role === 'owner' &&
      parsed.data.role !== 'owner' &&
      owners.every((o) => o.id === parsed.data.userId);
    if (wouldLeaveZeroOwners) {
      return { error: 'Cannot change the role of the household’s last owner.' } as const;
    }

    await tx
      .update(users)
      .set({ role: parsed.data.role })
      .where(and(eq(users.id, parsed.data.userId), eq(users.householdId, actingUser.householdId)));
    return { success: true } as const;
  });

  if (result.success) {
    revalidatePath('/settings/members');
  }
  return result;
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

  const result = await db.transaction(async (tx) => {
    // Same last-owner race and lock as changeMemberRoleAction — two owners concurrently
    // removing each other must not both succeed and leave the household ownerless.
    const owners = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.householdId, actingUser.householdId), eq(users.role, 'owner')))
      .for('update');

    // Same cross-household scoping as changeMemberRoleAction.
    const target = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.id, parsed.data.userId), eq(users.householdId, actingUser.householdId)))
      .limit(1);
    if (!target[0]) {
      return { error: 'Member not found.' } as const;
    }

    const wouldLeaveZeroOwners =
      target[0].role === 'owner' && owners.every((o) => o.id === parsed.data.userId);
    if (wouldLeaveZeroOwners) {
      return { error: 'Cannot remove the household’s last owner.' } as const;
    }

    // Deleting the user also cascades to their sessions (sessions.user_id ON DELETE
    // CASCADE), so a removed member's active sessions are invalidated immediately, not
    // just on next expiry.
    await tx
      .delete(users)
      .where(and(eq(users.id, parsed.data.userId), eq(users.householdId, actingUser.householdId)));
    return { success: true } as const;
  });

  if (result.success) {
    revalidatePath('/settings/members');
  }
  return result;
}
