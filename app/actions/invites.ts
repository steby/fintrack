'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { db } from '../../lib/db';
import { householdInvitations, users, sessions } from '../../lib/db/schema';
import { requireRole } from '../../lib/auth/guards';
import { generateToken } from '../../lib/auth/token';
import { inviteExpiry, validateInvite } from '../../lib/auth/invite-rules';
import { hashPassword, validatePassword } from '../../lib/auth/password';
import { createSession, SESSION_COOKIE_NAME } from '../../lib/auth/session';
import { sendInviteEmail } from '../../lib/email/invite';
import { env } from '../../lib/env';

const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'member', 'viewer']),
});

export type CreateInviteState = { error?: string; success?: boolean } | undefined;

export async function createInviteAction(
  _prevState: CreateInviteState,
  formData: FormData,
): Promise<CreateInviteState> {
  const actingUser = await requireRole('manage_members');

  const parsed = createInviteSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    return { error: 'Enter a valid email and role.' };
  }
  const { email, role } = parsed.data;

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) {
    return { error: 'That email is already a member of a household.' };
  }

  // Idempotency: a resubmit (double-click, retry after a slow/failed email send) must
  // not create a second live invitation for the same email. An invite whose own
  // expiry has already passed doesn't count — the owner should be able to send a
  // fresh one without waiting for cleanup.
  const existingInvite = await db
    .select({ id: householdInvitations.id })
    .from(householdInvitations)
    .where(
      and(
        eq(householdInvitations.email, email),
        eq(householdInvitations.householdId, actingUser.householdId),
        isNull(householdInvitations.acceptedAt),
        gt(householdInvitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (existingInvite[0]) {
    return { error: 'An invite is already pending for that email.' };
  }

  const token = generateToken();
  const expiresAt = inviteExpiry();

  await db.insert(householdInvitations).values({
    householdId: actingUser.householdId,
    email,
    role,
    token,
    invitedByUserId: actingUser.id,
    expiresAt,
  });

  const acceptUrl = `${env.APP_URL}/invite/${token}`;
  await sendInviteEmail(email, acceptUrl);

  return { success: true };
}

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1, 'Name is required'),
  password: z.string(),
});

export type AcceptInviteState = { error?: string } | undefined;

export async function acceptInviteAction(
  _prevState: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const parsed = acceptInviteSchema.safeParse({
    token: formData.get('token'),
    name: formData.get('name'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: 'Fill in all fields.' };
  }
  const { token, name, password } = parsed.data;

  const validation = validatePassword(password);
  if (!validation.valid) {
    return { error: validation.message };
  }

  // Looked up by the token value itself (not a separate id) — the URL param IS the
  // whole credential here, same pattern as sessions (see lib/auth/token.ts).
  const rows = await db
    .select()
    .from(householdInvitations)
    .where(eq(householdInvitations.token, token))
    .limit(1);
  const invitation = rows[0];

  if (!invitation) {
    return { error: 'This invite link is invalid.' };
  }

  const result = validateInvite(invitation, token);
  if (!result.valid) {
    const messages: Record<typeof result.reason, string> = {
      token_mismatch: 'This invite link is invalid.',
      already_accepted: 'This invite has already been used.',
      expired: 'This invite link has expired. Ask the household owner to send a new one.',
    };
    return { error: messages[result.reason] };
  }

  const passwordHash = await hashPassword(password);

  // The UPDATE below (`WHERE accepted_at IS NULL`) is the real concurrency guard, not
  // the validateInvite() check above — that check ran against a row read before this
  // transaction started, so two concurrent submissions of the same link could both
  // pass it. Only one concurrent UPDATE with this WHERE clause can ever affect a row
  // (Postgres serializes the two via row-level locking), so "did the update affect a
  // row" is what actually decides which request wins the race, before either one ever
  // touches `users`.
  const newUser = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(householdInvitations)
      .set({ acceptedAt: new Date() })
      .where(
        and(eq(householdInvitations.id, invitation.id), isNull(householdInvitations.acceptedAt)),
      )
      .returning({ id: householdInvitations.id });

    if (!claimed[0]) {
      return null;
    }

    const [user] = await tx
      .insert(users)
      .values({
        householdId: invitation.householdId,
        email: invitation.email,
        passwordHash,
        name,
        role: invitation.role,
      })
      .returning();
    return user;
  });

  if (!newUser) {
    return { error: 'This invite has already been used.' };
  }

  // If the submitting browser already has a session (e.g. an already-logged-in owner
  // opened their own invite link, or a stale tab), revoke it before creating the new
  // one — otherwise it's an orphaned-but-valid row until its own 30-day expiry.
  const cookieStore = await cookies();
  const existingToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (existingToken) {
    await db.delete(sessions).where(eq(sessions.id, existingToken));
  }

  await createSession(newUser.id);
  redirect('/');
}
