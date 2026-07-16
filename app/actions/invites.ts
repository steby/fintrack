'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { eq, and, isNull, lt } from 'drizzle-orm';
import { db } from '../../lib/db';
import { householdInvitations, users, sessions } from '../../lib/db/schema';
import { requireRole } from '../../lib/auth/guards';
import { generateToken, hashToken } from '../../lib/auth/token';
import { inviteExpiry, validateInvite } from '../../lib/auth/invite-rules';
import { hashPassword, validatePassword } from '../../lib/auth/password';
import { createSession, SESSION_COOKIE_NAME } from '../../lib/auth/session';
import { sendInviteEmail } from '../../lib/email/invite';
import { env } from '../../lib/env';
import { normalizeEmail, emailEquals } from '../../lib/auth/email';

const createInviteSchema = z.object({
  // Normalized at the parse boundary — see lib/auth/email.ts. Every subsequent use of
  // parsed.data.email in this action (duplicate check, stored invitation row, the
  // email actually sent to) is already consistent.
  email: z.string().email().transform(normalizeEmail),
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

  // Case-insensitive so inviting "bob@x.com" is correctly recognized as a duplicate
  // when "Bob@X.com" (predating normalizeEmail, or any other source of mixed casing)
  // already exists — see lib/auth/email.ts.
  const existing = await db.select().from(users).where(emailEquals(users.email, email)).limit(1);
  if (existing[0]) {
    return { error: 'That email is already a member of a household.' };
  }

  const token = generateToken();
  const expiresAt = inviteExpiry();

  // Idempotency: a resubmit (double-click, retry after a slow/failed email send) must
  // not create a second live invitation for the same email. Enforced atomically by the
  // household_invitations_household_email_pending_unique partial index (one unaccepted
  // invite per household+email) — NOT by a separate SELECT-then-INSERT, which is a
  // TOCTOU race: two concurrent requests could both pass a SELECT check before either
  // INSERT commits. When the existing pending invite has expired, this reissues it
  // in place (fresh token + expiry) rather than requiring cleanup first.
  const [invite] = await db
    .insert(householdInvitations)
    .values({
      householdId: actingUser.householdId,
      email,
      role,
      token,
      invitedByUserId: actingUser.id,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [householdInvitations.householdId, householdInvitations.email],
      targetWhere: isNull(householdInvitations.acceptedAt),
      set: { role, token, invitedByUserId: actingUser.id, expiresAt, createdAt: new Date() },
      setWhere: lt(householdInvitations.expiresAt, new Date()),
    })
    .returning({ id: householdInvitations.id });

  if (!invite) {
    return { error: 'An invite is already pending for that email.' };
  }

  const acceptUrl = `${env.APP_URL}/invite/${token}`;
  await sendInviteEmail(email, acceptUrl);

  // Added Phase 11: the restyled Members page now shows a "Pending invites" list
  // (spec.md Phase 11 task 5, adopting empty-state.tsx on that surface) fetched by
  // app/(app)/settings/members/page.tsx's own Server Component render — without this,
  // a household sending an invite through the restyled InviteForm (a direct
  // startTransition call, not a `<form action={...}>` navigation) would need a full
  // manual reload before the new invite ever appeared in that list. Not a loosened
  // check — purely a cache-invalidation addition, same category as Phase 9's
  // `updateActualAction` gaining a second `revalidatePath('/')` when Home started
  // depending on its data too.
  revalidatePath('/settings/members');

  return { success: true };
}

const acceptInviteSchema = z.object({
  token: z.string().min(1).max(200),
  // .max caps match the rest of the app: 200 on name (same as account.ts's
  // updateNameSchema — this value becomes users.name and renders on every page) and
  // 200 on password (loginSchema's documented defense-in-depth against feeding argon2
  // an attacker-sized input on a pre-auth endpoint).
  name: z.string().min(1, 'Name is required').max(200),
  password: z.string().max(200),
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
  // whole credential. Unlike sessions (stored as hashToken(token) since the at-rest
  // hardening pass), invite tokens are deliberately stored raw: they expire in 7 days,
  // exist only while an invite is pending, and the raw value already lives in a sent
  // email — hashing them buys little and would complicate the resend flow.
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

  // household_invitations' own uniqueness is per-household (schema.ts's
  // household_invitations_household_email_pending_unique), so the same email can hold
  // a valid pending invite in two DIFFERENT households at once — e.g. accepted in
  // household A first (a real `users` row now exists for that email, since users.email
  // is globally unique), then later opening household B's still-valid invite link for
  // the same email. Checked here, before claiming the invite, so a doomed accept
  // doesn't burn an otherwise-still-valid invitation — the household owner can still
  // reissue or the person can log in with the account they already have.
  // Case-insensitive for the same reason as createInviteAction's duplicate check —
  // invitation.email may predate normalizeEmail (this invitation could have been
  // created before this fix shipped).
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(emailEquals(users.email, invitation.email))
    .limit(1);
  if (existingUser[0]) {
    return {
      error: 'An account with this email already exists — log in instead of accepting this invite.',
    };
  }

  // The UPDATE below (`WHERE accepted_at IS NULL`) is the real concurrency guard, not
  // the validateInvite() check above — that check ran against a row read before this
  // transaction started, so two concurrent submissions of the same link could both
  // pass it. Only one concurrent UPDATE with this WHERE clause can ever affect a row
  // (Postgres serializes the two via row-level locking), so "did the update affect a
  // row" is what actually decides which request wins the race, before either one ever
  // touches `users`.
  let newUser;
  try {
    newUser = await db.transaction(async (tx) => {
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
          // Normalized even though createInviteAction already normalizes on write —
          // this invitation could have been created before that fix shipped, and this
          // is the one place a new users.email row actually gets written from it.
          email: normalizeEmail(invitation.email),
          passwordHash,
          name,
          role: invitation.role,
        })
        .returning();
      return user;
    });
  } catch (err) {
    // Defense-in-depth for the residual race the pre-check above can't close: two
    // invites for the same email (different households) accepted at nearly the same
    // moment could both pass the pre-check before either INSERT commits. Postgres's
    // own users_email_unique index is the real backstop here — '23505' is its unique-
    // violation code (see lib/db/schema.integration.test.ts for the same check).
    // Throwing (rather than returning) inside the transaction callback above rolled
    // back the invite claim too, so the invite is still valid/unclaimed after this,
    // same end state as the pre-check catching it earlier.
    if (err instanceof Error && 'cause' in err) {
      const cause = err.cause;
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '23505') {
        return {
          error:
            'An account with this email already exists — log in instead of accepting this invite.',
        };
      }
    }
    throw err;
  }

  if (!newUser) {
    return { error: 'This invite has already been used.' };
  }

  // If the submitting browser already has a session (e.g. an already-logged-in owner
  // opened their own invite link, or a stale tab), it should end up revoked — otherwise
  // it's an orphaned-but-valid row until its own 30-day expiry. The new session is
  // created FIRST, deliberately: the invite above is already irreversibly accepted, so
  // if the old-session delete ran first and createSession() then failed, the user would
  // be left fully logged out with no way back in. Creating first means a failure here
  // just leaves the old session (still valid) alongside the accepted invite — recoverable.
  const cookieStore = await cookies();
  const existingToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  await createSession(newUser.id);

  if (existingToken) {
    await db.delete(sessions).where(eq(sessions.id, hashToken(existingToken)));
  }

  redirect('/');
}
